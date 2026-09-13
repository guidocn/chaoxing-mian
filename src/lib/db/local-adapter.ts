import type { DBAdapter, Row } from "@/types/env";

/**
 * 极简本地 SQLite 兼容适配器（仅用于本地 `next dev` 预览）。
 *
 * Cloudflare 部署时使用 D1（见 d1-adapter.ts）。
 * 本地实现基于 JSON 文件的简易"表"抽象，只覆盖本平台用到的少量 SQL 形态：
 *  - SELECT ... WHERE col = ? / col IN (...) / ORDER BY / LIMIT
 *  - INSERT / UPDATE / DELETE
 * 为避免引入原生 sqlite 依赖导致沙箱构建失败，这里用内存 + JSON 落盘实现。
 */

type Table = Record<string, Row>;

const TABLES = [
  "users",
  "cx_accounts",
  "tasks",
  "task_logs",
  "courses",
  "settings",
] as const;
type TableName = (typeof TABLES)[number];

// 运行期单例，热更新时尽量保留
declare global {
  // eslint-disable-next-line no-var
  var __LOCAL_DB__: LocalDB | undefined;
}

class LocalDB implements DBAdapter {
  private tables = new Map<TableName, Table>();
  private filePath = "";
  private autoSeq = new Map<string, number>();

  async init(): Promise<void> {
    const path = await import("path");
    const fs = await import("fs/promises");
    this.filePath = path.join(process.cwd(), ".local-db.json");
    let loaded: Record<string, Table> = {};
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      loaded = JSON.parse(raw);
    } catch {
      loaded = {};
    }
    for (const t of TABLES) {
      this.tables.set(t, loaded[t] ?? {});
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    const fs = await import("fs/promises");
    const data: Record<string, Table> = {};
    for (const [k, v] of this.tables) data[k] = v;
    await fs.writeFile(this.filePath, JSON.stringify(data), "utf-8");
  }

  private table(name: TableName): Table {
    let t = this.tables.get(name);
    if (!t) {
      t = {};
      this.tables.set(name, t);
    }
    return t;
  }

  private nextId(name: TableName, rows: Row[]): number {
    let max = this.autoSeq.get(name) ?? 0;
    for (const r of rows) {
      const id = Number(r.id);
      if (id > max) max = id;
    }
    max += 1;
    this.autoSeq.set(name, max);
    return max;
  }

  // 仅实现本平台所需：INSERT INTO t (cols) VALUES (?,?)
  async run(query: string, ...params: unknown[]): Promise<{ lastRowId: number }> {
    const q = query.trim();
    const insertMatch = /^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(q);
    if (insertMatch) {
      const [, tableRaw, colsRaw] = insertMatch;
      const table = tableRaw as TableName;
      const cols = colsRaw.split(",").map((s) => s.trim());
      const rows = Object.values(this.table(table));
      const id = this.nextId(table, rows);
      const row: Row = { id };
      cols.forEach((c, i) => {
        row[c] = params[i] ?? null;
      });
      this.table(table)[String(id)] = row;
      await this.persist();
      return { lastRowId: id };
    }

    const updateMatch = /^UPDATE (\w+) SET (.+?)(?: WHERE (.+))?$/is.exec(q);
    if (updateMatch) {
      const [, tableRaw, setRaw, whereRaw] = updateMatch;
      const table = tableRaw as TableName;
      const setCols = setRaw.split(",").map((s) => s.trim().replace(/\s*=\s*\?/s, ""));
      const targets = this.matchWhere(this.table(table), whereRaw, params, setCols.length);
      for (const { row } of targets.matched) {
        setCols.forEach((c, i) => {
          row[c] = targets.consumed[i] ?? null;
        });
      }
      await this.persist();
      return { lastRowId: 0 };
    }

    const delMatch = /^DELETE FROM (\w+)(?: WHERE (.+))?$/is.exec(q);
    if (delMatch) {
      const [, tableRaw, whereRaw] = delMatch;
      const table = tableRaw as TableName;
      const t = this.table(table);
      const targets = this.matchWhere(t, whereRaw, params, 0);
      for (const { key } of targets.matched) delete t[key];
      await this.persist();
      return { lastRowId: 0 };
    }

    // 兜底：忽略无法解析的语句
    return { lastRowId: 0 };
  }

  // 解析简单 WHERE：col = ? [AND ...] / col IN (?,?) / col IS NULL
  private matchWhere(
    t: Table,
    whereRaw: string | undefined,
    params: unknown[],
    consumedOffset: number,
  ): { matched: { key: string; row: Row }[]; consumed: unknown[] } {
    const entries = Object.entries(t);
    if (!whereRaw) {
      return { matched: entries.map(([key, row]) => ({ key, row })), consumed: params as unknown[] };
    }
    // 按 AND 拆分（本平台不使用 OR）
    const conds = whereRaw.split(/\s+AND\s+/is);
    let pi = consumedOffset;
    const predicates: ((row: Row) => boolean)[] = [];
    const usedParams: unknown[] = [];
    for (const cond of conds) {
      const inMatch = /^(\w+)\s+IN\s*\(([^)]*)\)$/is.exec(cond.trim());
      if (inMatch) {
        const col = inMatch[1];
        const n = inMatch[2].split("?").length - 1;
        const vals = params.slice(pi, pi + n);
        usedParams.push(...vals);
        pi += n;
        predicates.push((row) => vals.map(String).includes(String(row[col])));
        continue;
      }
      const eqMatch = /^(\w+)\s*=\s*\?$/.exec(cond.trim());
      if (eqMatch) {
        const col = eqMatch[1];
        const val = params[pi];
        usedParams.push(val);
        pi += 1;
        predicates.push((row) => String(row[col]) === String(val));
        continue;
      }
      if (/^\w+\s+IS NULL$/is.test(cond.trim())) {
        const col = cond.trim().split(/\s+/)[0];
        predicates.push((row) => row[col] === null || row[col] === undefined || row[col] === "");
        continue;
      }
    }
    const matched = entries
      .filter(([, row]) => predicates.every((fn) => fn(row)))
      .map(([key, row]) => ({ key, row }));
    return { matched, consumed: usedParams };
  }

  async get<T = Row>(query: string, ...params: unknown[]): Promise<T | null> {
    const rows = await this.all<Row>(query, ...params);
    return (rows[0] as T) ?? null;
  }

  async all<T = Row>(query: string, ...params: unknown[]): Promise<T[]> {
    const q = query.trim();
    const m = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+?))?(?: LIMIT (\d+))?$/is.exec(
      q.replace(/\s+/g, " "),
    );
    if (!m) return [];
    const [, colsRaw, tableRaw, whereRaw, orderRaw, limitRaw] = m;
    const table = tableRaw as TableName;
    const { matched } = this.matchWhere(this.table(table), whereRaw, params, 0);
    let rows = matched.map((x) => x.row);
    if (orderRaw) {
      const [col, dir] = orderRaw.trim().split(/\s+/);
      rows.sort((a, b) => {
        const av = a[col] as number;
        const bv = b[col] as number;
        const cmp = (Number(av) || 0) - (Number(bv) || 0);
        return /desc/i.test(dir ?? "") ? -cmp : cmp;
      });
    }
    if (limitRaw) rows = rows.slice(0, Number(limitRaw));
    if (colsRaw.trim() === "COUNT(*) AS c") {
      return [{ c: rows.length }] as unknown as T[];
    }
    return rows as T[];
  }

  async exec(_sql: string): Promise<void> {
    // 建表语句在本地实现中无需处理（表懒创建）
  }
}

let initPromise: Promise<LocalDB> | null = null;

export async function getLocalDB(): Promise<LocalDB> {
  if (globalThis.__LOCAL_DB__) return globalThis.__LOCAL_DB__;
  if (!initPromise) {
    const db = new LocalDB();
    initPromise = db.init().then(() => db);
  }
  const db = await initPromise;
  globalThis.__LOCAL_DB__ = db;
  return db;
}
