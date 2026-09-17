import { getCxAccount, getTaskByAccount } from "@/lib/db/repo";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

// 临时诊断：查看任务状态机数据 + 直接测试章节拉取
export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const out: Record<string, unknown> = {};

  // 任务 1（verify_b 的第一个账号）与 2（用户超星账号）都看一下
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
      state: state,
      state_parse_err: stateErr || undefined,
    };
  }

  return Response.json(out);
}
