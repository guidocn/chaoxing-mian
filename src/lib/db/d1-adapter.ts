import type { DBAdapter, Row } from "@/types/env";

// Cloudflare D1 适配器：把统一接口桥接到 D1Database
export class D1Adapter implements DBAdapter {
  constructor(private d1: D1Database) {}

  async all<T = Row>(query: string, ...params: unknown[]): Promise<T[]> {
    const stmt = this.d1.prepare(query).bind(...(params as never[]));
    const res = await stmt.all<T>();
    return (res.results ?? []) as T[];
  }

  async get<T = Row>(query: string, ...params: unknown[]): Promise<T | null> {
    const stmt = this.d1.prepare(query).bind(...(params as never[]));
    return stmt.first<T>();
  }

  async run(query: string, ...params: unknown[]): Promise<{ lastRowId: number }> {
    const stmt = this.d1.prepare(query).bind(...(params as never[]));
    const res = await stmt.run();
    return { lastRowId: Number(res.meta?.last_row_id ?? 0) };
  }

  async exec(sql: string): Promise<void> {
    await this.d1.exec(sql);
  }
}
