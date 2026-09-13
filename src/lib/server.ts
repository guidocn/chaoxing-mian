import { getDB } from "./db";
import { cookies } from "next/headers";
import { getUserById } from "./db/repo";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import type { UserRow } from "./types";
import type { DBAdapter } from "@/types/env";

// 运行时绑定与密钥：
// - Cloudflare Pages/Workers：通过 getCloudflareContext().env 拿到 D1 绑定 DB 与变量
// - 本地 next dev：退化为 process.env + JSON 文件存储
export interface RuntimeContext {
  db: DBAdapter;
  secret?: string;
  adminSetupCode?: string;
  d1?: D1Database;
}

async function cloudflareEnv(): Promise<{
  DB?: D1Database;
  APP_SECRET?: string;
  ADMIN_SETUP_CODE?: string;
}> {
  try {
    // 仅在 Cloudflare 运行时存在；本地 dev 下该模块不可用，走 catch
    const mod = (await import("@cloudflare/next-on-pages")) as {
      getCloudflareContext?: () => {
        env: {
          DB?: D1Database;
          APP_SECRET?: string;
          ADMIN_SETUP_CODE?: string;
        };
      };
    };
    const ctx = mod.getCloudflareContext?.();
    return ctx?.env ?? {};
  } catch {
    return {};
  }
}

export async function getRuntime(): Promise<RuntimeContext> {
  const cf = await cloudflareEnv();
  const d1 = cf.DB;
  const db = await getDB(d1 ? { DB: d1 } : undefined);
  return {
    db,
    d1,
    secret: cf.APP_SECRET ?? process.env.APP_SECRET,
    adminSetupCode: cf.ADMIN_SETUP_CODE ?? process.env.ADMIN_SETUP_CODE,
  };
}

export interface AuthContext {
  user: UserRow;
  db: DBAdapter;
  secret?: string;
  adminSetupCode?: string;
}

/** 要求已登录 */
export async function requireUser(): Promise<
  AuthContext | { error: string; status: number }
> {
  const rt = await getRuntime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token, rt.secret);
  if (!session) return { error: "未登录", status: 401 };
  const user = await getUserById(rt.db, session.userId);
  if (!user) return { error: "用户不存在", status: 401 };
  if (user.status === "banned") return { error: "账号已被封禁", status: 403 };
  return {
    user,
    db: rt.db,
    secret: rt.secret,
    adminSetupCode: rt.adminSetupCode,
  };
}

/** 要求管理员 */
export async function requireAdmin(): Promise<
  AuthContext | { error: string; status: number }
> {
  const ctx = await requireUser();
  if ("error" in ctx) return ctx;
  if (ctx.user.role !== "admin") return { error: "需要管理员权限", status: 403 };
  return ctx;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
