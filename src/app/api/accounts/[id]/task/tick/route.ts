import { NextRequest } from "next/server";
import { getCxAccount, getTaskByAccount, getTaskById, updateTaskRow } from "@/lib/db/repo";
import { nowSec } from "@/lib/db";
import { reloginAccount, runTick } from "@/lib/engine/tick";
import { requireUser } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 推进一次任务（前端轮询调用）
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }

  let task = await getTaskByAccount(ctx.db, account.id);
  if (!task) return Response.json({ ok: false, message: "任务不存在" }, { status: 404 });

  // 若处于需要登录状态，先尝试用保存的密码自动重登
  if (task.status === "login_required") {
    const relogin = await reloginAccount(ctx.db, account, ctx.secret);
    if (relogin.ok) {
      task = (await getTaskById(ctx.db, task.id)) ?? task;
      await updateTaskRow(ctx.db, task.id, { status: "running", error_message: "", updated_at: nowSec() });
      task = (await getTaskById(ctx.db, task.id)) ?? task;
    } else {
      return Response.json({
        ok: false,
        status: "login_required",
        message: `需要重新登录：${relogin.message}`,
      });
    }
  }

  if (task.status === "paused") {
    return Response.json({ ok: true, status: "paused", message: "任务已暂停" });
  }
  if (task.status === "done") {
    return Response.json({ ok: true, status: "done", message: "任务已完成" });
  }

  // 标记开始时间
  if (!task.started_at) {
    await updateTaskRow(ctx.db, task.id, { started_at: nowSec(), status: "running" });
  }

  try {
    const outcome = await runTick(ctx.db, task.id, ctx.secret);
    const updated = await getTaskById(ctx.db, task.id);
    return Response.json({
      ok: true,
      done: outcome.done,
      status: outcome.status,
      task: updated
        ? {
            id: updated.id,
            status: updated.status,
            phase: updated.phase,
            current_course: updated.current_course,
            current_chapter: updated.current_chapter,
            progress: updated.progress,
            total_points: updated.total_points,
            done_points: updated.done_points,
            error_message: updated.error_message,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, message: msg }, { status: 500 });
  }
}
