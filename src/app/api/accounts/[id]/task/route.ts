import { NextRequest } from "next/server";
import {
  countCoursesByAccount,
  createTask,
  getCxAccount,
  getTaskByAccount,
} from "@/lib/db/repo";
import { requireUser } from "@/lib/server";
import { serializeAccount, serializeTask } from "@/lib/serialize";

export const runtime = "edge";

// 获取某账号信息与其当前任务
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }
  const task = await getTaskByAccount(ctx.db, account.id);
  const total = await countCoursesByAccount(ctx.db, account.id);
  const selected = await countCoursesByAccount(ctx.db, account.id, 1);
  return Response.json({
    ok: true,
    account: serializeAccount(account, task, total, selected),
    task: serializeTask(task),
  });
}

// 创建任务（如需新参数）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    speed?: number;
    autoSubmit?: boolean;
    tikuProvider?: string;
    tikuApi?: string;
    tikuToken?: string;
  };

  const existing = await getTaskByAccount(ctx.db, account.id);
  if (existing) {
    return Response.json({ ok: true, taskId: existing.id, reused: true });
  }

  const taskId = await createTask(ctx.db, {
    accountId: account.id,
    userId: ctx.user.id,
    speed: clampSpeed(body.speed ?? 2),
    autoSubmit: body.autoSubmit === false ? 0 : 1,
    tikuProvider: body.tikuProvider ?? "none",
    tikuApi: body.tikuApi ?? "",
    tikuToken: body.tikuToken ?? "",
    skipLocked: 1,
  });
  return Response.json({ ok: true, taskId });
}

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.min(16, Math.max(1, n));
}
