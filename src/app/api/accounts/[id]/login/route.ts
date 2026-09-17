import { NextRequest } from "next/server";
import { getCxAccount, updateCxAccount } from "@/lib/db/repo";
import { nowSec } from "@/lib/db";
import { appEncrypt } from "@/lib/crypto";
import { chaoxingLogin } from "@/lib/chaoxing/api";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

// 立即登录超星（用保存的密码，或前端传入的新手机号/密码）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { phone?: string; password?: string };
  const phone = (body.phone ?? "").trim() || account.phone;
  let password = body.password ?? "";
  if (!password) {
    const { appDecrypt } = await import("@/lib/crypto");
    password = appDecrypt(account.password_enc, ctx.secret) ?? "";
  }
  if (!password) {
    return Response.json({ ok: false, message: "请输入密码" }, { status: 400 });
  }

  await updateCxAccount(ctx.db, account.id, {
    login_status: "logging",
    login_message: "登录中",
  });

  const result = await chaoxingLogin(phone, password);
  if (!result.ok) {
    await updateCxAccount(ctx.db, account.id, {
      login_status: "error",
      login_message: result.message,
    });
    return Response.json({ ok: false, message: result.message });
  }

  await updateCxAccount(ctx.db, account.id, {
    login_status: "online",
    login_message: "登录成功",
    cookies: JSON.stringify(result.cookies),
    fid: result.fid,
    uid: result.uid,
    cx_name: result.name,
    phone,
    password_enc: body.password ? appEncrypt(body.password, ctx.secret) : account.password_enc,
    last_login_at: nowSec(),
    last_active_at: nowSec(),
  });

  return Response.json({ ok: true, message: "登录成功", name: result.name });
}
