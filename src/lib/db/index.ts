import type { DBAdapter } from "@/types/env";
import { D1Adapter } from "./d1-adapter";
import { getLocalDB } from "./local-adapter";

let cached: DBAdapter | null = null;

/**
 * 获取数据库适配器：
 * - 请求内传入了 Cloudflare env.DB 时使用 D1
 * - 本地 next dev 无 D1 绑定时退化为 JSON 文件实现（.local-db.json）
 */
export async function getDB(env?: { DB?: D1Database }): Promise<DBAdapter> {
  if (env?.DB) return new D1Adapter(env.DB);
  if (cached) return cached;
  cached = await getLocalDB();
  return cached;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
