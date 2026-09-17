import { getCxAccount, getTaskByAccount, listRecentLogs } from "@/lib/db/repo";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

// 临时诊断：查看任务状态机数据 + 日志写入情况
export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const out: Record<string, unknown> = {};

  // 任务 1（guido 的账号）与 2（verify_b 的账号）都看一下
  for (const id of [1, 2]) {
    const account = await getCxAccount(ctx.db, id);
    if (!account) {
      out[`acc${id}`] = "不存在";
      continue;
    }
    const task = await getTaskByAccount(ctx.db, account.id);
    let state = null;
    let stateErr = "";
    try {
      state = task?.state ? JSON.parse(task.state) : null;
    } catch (e) {
      stateErr = e instanceof Error ? e.message : String(e);
    }
    const logs = task ? await listRecentLogs(ctx.db, task.id) : [];
    out[`acc${id}`] = {
      login_status: account.login_status,
      cookies_keys: account.cookies ? Object.keys(JSON.parse(account.cookies || "{}")).length : 0,
      task_status: task?.status,
      task_phase: task?.phase,
      current_course: task?.current_course,
      current_chapter: task?.current_chapter,
      progress: task?.progress,
      total_points: task?.total_points,
      done_points: task?.done_points,
      log_count: logs.length,
      latest_logs: logs.slice(-5).map((l) => l.message),
      state: state,
      state_parse_err: stateErr || undefined,
    };
  }

  return Response.json(out);
}
