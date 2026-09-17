import { getRequestContext, getCloudflareContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

// 临时诊断接口：对比 getRequestContext 与 getCloudflareContext 两种方式读取运行时 env，
// 并直接对 D1 执行查询。确认问题后请删除此文件。
export async function GET() {
  let rcKeys: string[] = [];
  let rcErr = "";
  let cfKeys: string[] = [];
  let cfErr = "";
  let dbTest = "getRequestContext().env.DB 不存在";

  // 方式一：getRequestContext（官方推荐的 Edge runtime API）
  try {
    const rc = getRequestContext();
    rcKeys = Object.keys(rc?.env ?? {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (rc?.env as Record<string, unknown> | undefined)?.DB as any;
    if (db) {
      try {
        const res = await db.prepare("SELECT COUNT(*) AS c FROM users").first();
        dbTest = `D1 可查询, users count = ${res?.c ?? "unknown"}`;
      } catch (e) {
        dbTest = `D1 绑定存在但查询失败: ${String(e)}`;
      }
    }
  } catch (e) {
    rcErr = `getRequestContext 抛错: ${String(e)}`;
  }

  // 方式二：getCloudflareContext（项目原用 API）
  try {
    const cf = getCloudflareContext();
    cfKeys = Object.keys(cf?.env ?? {});
  } catch (e) {
    cfErr = `getCloudflareContext 抛错: ${String(e)}`;
  }

  return Response.json({
    requestContext: { keys: rcKeys, err: rcErr },
    cloudflareContext: { keys: cfKeys, err: cfErr },
    dbTest,
  });
}
