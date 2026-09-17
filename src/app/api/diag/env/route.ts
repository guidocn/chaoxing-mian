export const runtime = "edge";

// 临时诊断接口：检查运行时 env 里是否有 D1 绑定（DB），以及 D1 是否可查询。
// 确认问题后请删除此文件。
export async function GET() {
  let env: Record<string, unknown> = {};
  let ctxErr = "";
  let dbTest = "env.DB 不存在";

  try {
    const mod = (await import("@cloudflare/next-on-pages")) as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    try {
      const ctx = mod.getCloudflareContext?.();
      env = ctx?.env ?? {};
    } catch (e) {
      ctxErr = `getCloudflareContext 抛错: ${String(e)}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (env as Record<string, unknown>).DB as any;
    if (db) {
      try {
        const res = await db.prepare("SELECT COUNT(*) AS c FROM users").first();
        dbTest = `D1 可查询, users count = ${res?.c ?? "unknown"}`;
      } catch (e) {
        dbTest = `D1 绑定存在但查询失败: ${String(e)}`;
      }
    }
  } catch (e) {
    ctxErr = `import 失败: ${String(e)}`;
  }

  return Response.json({
    keys: Object.keys(env),
    hasDB: Boolean(env.DB),
    dbTest,
    ctxErr,
  });
}
