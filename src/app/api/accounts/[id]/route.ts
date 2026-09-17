import { NextRequest } from "next/server";
import {
  deleteCxAccount,
  getCxAccount,
  getTaskByAccount,
  updateCxAccount,
  updateTaskRow,
} from "@/lib/db/repo";
import { requireUser } from "@/lib/server";
import { serializeAccount } from "@/lib/serialize";
import { countCoursesByAccount } from "@/lib/db/repo";

export const runtime = "edge";

async function loadOwned(ctx: Awaited<ReturnType<typeof requireUser>>, id: number) {
  if ("error" in ctx) return null;
  const account = await getCxAccount(ctx.db, id);
  if (!account || account.user_id !== ctx.user.id) return null;
  return account;
}

// 更新账号参数（倍速 / 自动提交 / 启用停用）
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const accountId = Number(id);
  const account = await loadOwned(ctx, accountId);
  if (!account) return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    speed?: number;
    autoSubmit?: boolean | number;
    active?: number | boolean;
  };

  if (typeof body.name === "string") {
    await updateCxAccount(ctx.db, accountId, { label: body.name.trim() || account.phone });
  }

  const task = await getTaskByAccount(ctx.db, accountId);
  if (task) {
    const patch: Record<string, unknown> = {};
    if (typeof body.speed === "number" && body.speed >= 1 && body.speed <= 16) {
      patch.speed = body.speed;
    }
    if (typeof body.autoSubmit !== "undefined") {
      patch.auto_submit = body.autoSubmit ? 1 : 0;
    }
    // 停用：暂停运行中的任务并标记 offline；启用恢复 online/idle
    if (body.active === 0 || body.active === false) {
      if (task.status === "running" || task.status === "paused") patch.status = "idle";
      await updateCxAccount(ctx.db, accountId, { login_status: "offline" });
    } else if (body.active === 1 || body.active === true) {
      if (account.login_status === "offline") {
        const hasCookies = account.cookies && account.cookies !== "{}";
        await updateCxAccount(ctx.db, accountId, {
          login_status: hasCookies ? "online" : "idle",
        });
      }
    }
    if (Object.keys(patch).length > 0) await updateTaskRow(ctx.db, task.id, patch as never);
  }

  const fresh = await getCxAccount(ctx.db, accountId);
  const t = await getTaskByAccount(ctx.db, accountId);
  const total = await countCoursesByAccount(ctx.db, accountId);
  const selected = await countCoursesByAccount(ctx.db, accountId, 1);
  return Response.json({
    ok: true,
    account: serializeAccount(fresh!, t, total, selected),
  });
}

// 删除绑定的超星账号（连带任务/课程/日志）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await loadOwned(ctx, Number(id));
  if (!account) return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  await deleteCxAccount(ctx.db, account.id);
  return Response.json({ ok: true });
}
