import { NextRequest } from "next/server";
import { countUsers, createUser, findUserByEmail } from "@/lib/db/repo";
import { hashPassword } from "@/lib/auth-password";
import { createSessionToken, buildSetCookie, SESSION_MAX_AGE } from "@/lib/session";
import { getRuntime } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    nickname?: string;
    setupCode?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const nickname = (body.nickname ?? "").trim() || email.split("@")[0];

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ ok: false, message: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) return Response.json({ ok: false, message: "密码至少 6 位" }, { status: 400 });

  const rt = await getRuntime();
  const db = rt.db;

  const exist = await findUserByEmail(db, email);
  if (exist) return Response.json({ ok: false, message: "该邮箱已注册" }, { status: 409 });

  const userCount = await countUsers(db);
  let role: "admin" | "user" = "user";
  if (userCount === 0) {
    role = "admin"; // 首个注册用户为管理员
  } else if (rt.adminSetupCode && body.setupCode === rt.adminSetupCode) {
    role = "admin";
  }

  const passwordHash = await hashPassword(password, rt.secret);
  const id = await createUser(db, { email, passwordHash, nickname, role, quota: role === "admin" ? 50 : 3 });
  const token = await createSessionToken({ userId: id, role }, rt.secret);

  return new Response(JSON.stringify({ ok: true, user: { id, email, nickname, role } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": buildSetCookie(token, SESSION_MAX_AGE),
    },
  });
}
