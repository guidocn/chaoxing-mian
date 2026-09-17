import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

// 临时诊断接口：检查运行时 env 里是否有 D1 绑定（DB），并直接对 D1 执行查询。
// 确认问题后请删除此文件。
export async function GET() {
  let keys: string[] = [];
  let err = "";
  let dbTest = "env.DB 不存在";

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = getRequestContext().env as Record<string, unknown>;
    keys = Object.keys(env);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = env?.DB as any;
    if (db) {
      try {
        const res = await db.prepare("SELECT COUNT(*) AS c FROM users").first();
        dbTest = `D1 可查询, users count = ${res?.c ?? "unknown"}`;
      } catch (e) {
        dbTest = `D1 绑定存在但查询失败: ${String(e)}`;
      }
    }
  } catch (e) {
    err = `getRequestContext 抛错: ${String(e)}`;
  }

  return Response.json({ keys, hasDB: keys.includes("DB"), dbTest, err });
}
