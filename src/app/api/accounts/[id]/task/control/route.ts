import { NextRequest } from "next/server";
import { getCxAccount, getTaskByAccount, updateTaskRow } from "@/lib/db/repo";
import { nowSec } from "@/lib/db";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

// 任务控制  body: { action: 'start' | 'pause' | 'reset' }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }
  const task = await getTaskByAccount(ctx.db, account.id);
  if (!task) return Response.json({ ok: false, message: "任务不存在" }, { status: 404 });

  switch (body.action) {
    case "start":
    case "resume":
      if (account.login_status !== "online") {
        return Response.json({ ok: false, message: "请先登录超星账号" }, { status: 400 });
      }
      // 保留已有进度（state 非空时续刷：刷过的章节跳过、刷一半的视频从断点继续），
      // 想从头重刷请先点"重置"
      const resumeState = task.state && task.state !== "{}" && task.state !== "" ? task.state : "{}";
      await updateTaskRow(ctx.db, task.id, {
        status: "running",
        error_message: "",
        state: resumeState,
        started_at: task.started_at ?? nowSec(),
        finished_at: null,
        updated_at: nowSec(),
      });
      break;
    case "pause":
      await updateTaskRow(ctx.db, task.id, { status: "paused", updated_at: nowSec() });
      break;
    case "reset":
    case "stop":
      await updateTaskRow(ctx.db, task.id, {
        status: "idle",
        phase: "",
        current_course: "",
        current_chapter: "",
        progress: 0,
        total_points: 0,
        done_points: 0,
        error_message: "",
        state: "{}",
        stats: "{}",
        finished_at: nowSec(),
        updated_at: nowSec(),
      });
      await ctx.db.run("DELETE FROM task_logs WHERE task_id = ?", task.id);
      break;
    default:
      return Response.json({ ok: false, message: "未知操作" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
