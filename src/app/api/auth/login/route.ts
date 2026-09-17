import { NextRequest } from "next/server";
import { findUserByEmail, updateUserLastLogin } from "@/lib/db/repo";
import { verifyPassword } from "@/lib/auth-password";
import { createSessionToken, buildSetCookie, SESSION_MAX_AGE } from "@/lib/session";
import { getRuntime } from "@/lib/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json({ ok: false, message: "请输入邮箱和密码" }, { status: 400 });
  }

  const rt = await getRuntime();
  const db = rt.db;
  const user = await findUserByEmail(db, email);
  if (!user) return Response.json({ ok: false, message: "邮箱或密码错误" }, { status: 401 });
  if (user.status === "banned") return Response.json({ ok: false, message: "账号已被封禁" }, { status: 403 });

  const valid = await verifyPassword(password, user.password_hash, rt.secret);
  if (!valid) return Response.json({ ok: false, message: "邮箱或密码错误" }, { status: 401 });

  await updateUserLastLogin(db, user.id);
  const token = await createSessionToken({ userId: user.id, role: user.role }, rt.secret);

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": buildSetCookie(token, SESSION_MAX_AGE),
      },
    },
  );
}
