import { NextRequest } from "next/server";
import { getCxAccount } from "@/lib/db/repo";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

// 勾选/取消勾选课程（:courseId 为超星课程 ID）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; courseId: string }> },
) {
  const ctx = await requireUser();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id, courseId } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { active?: number | boolean; selected?: boolean };
  const active =
    typeof body.active !== "undefined" ? body.active : body.selected;
  const val = active ? 1 : 0;
  await ctx.db.run(
    "UPDATE courses SET selected = ? WHERE account_id = ? AND course_id = ?",
    val,
    account.id,
    courseId,
  );
  return Response.json({ ok: true });
}
