import { NextRequest } from "next/server";
import { appEncrypt } from "@/lib/crypto";
import {
  countCoursesByAccount,
  countCxAccounts,
  createCxAccount,
  getTaskByAccount,
  listCxAccounts,
} from "@/lib/db/repo";
import { requireUser } from "@/lib/server";
import { serializeAccount } from "@/lib/serialize";

export const runtime = "edge";

// 列出当前用户绑定的超星账号
export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const rows = await listCxAccounts(ctx.db, ctx.user.id);
  const accounts = await Promise.all(
    rows.map(async (a) => {
      const task = await getTaskByAccount(ctx.db, a.id);
      const total = await countCoursesByAccount(ctx.db, a.id);
      const selected = await countCoursesByAccount(ctx.db, a.id, 1);
      return serializeAccount(a, task, total, selected);
    }),
  );
  return Response.json({ ok: true, accounts });
}

// 绑定新的超星账号
export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const body = (await req.json().catch(() => ({}))) as {
    phone?: string;
    password?: string;
    name?: string;
    label?: string;
    speed?: number;
    autoSubmit?: boolean;
  };
  const phone = (body.phone ?? "").trim();
  const password = body.password ?? "";
  const label = (body.name ?? body.label ?? "").trim() || phone;
  if (!phone || !password) {
    return Response.json(
      { ok: false, message: "请填写超星手机号和密码" },
      { status: 400 },
    );
  }

  const count = await countCxAccounts(ctx.db, ctx.user.id);
  if (count >= ctx.user.quota) {
    return Response.json(
      { ok: false, message: `已达账号数量上限（${ctx.user.quota} 个）` },
      { status: 403 },
    );
  }

  const enc = appEncrypt(password, ctx.secret);
  const id = await createCxAccount(ctx.db, { userId: ctx.user.id, label, phone, passwordEnc: enc });

  // 立即创建对应任务配置（speed 固定 1x / autoSubmit / 题库）
  const { createTask } = await import("@/lib/db/repo");
  await createTask(ctx.db, {
    accountId: id,
    userId: ctx.user.id,
    speed: 1, // 固定 1x：真实速率观看，防止被超星判定异常观看不累计
    autoSubmit: body.autoSubmit === false ? 0 : 1,
    tikuProvider: "none",
    tikuApi: "",
    tikuToken: "",
    skipLocked: 1,
  });

  return Response.json({ ok: true, id });
}
