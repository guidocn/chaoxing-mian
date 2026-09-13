import { NextRequest } from "next/server";
import {
  deleteUserCascade,
  getUserById,
  setUserRole,
  setUserStatus,
} from "@/lib/db/repo";
import { requireAdmin } from "@/lib/server";

export const runtime = "nodejs";

// body: { action: 'promote' | 'demote' | 'ban' | 'unban' | 'delete' }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const userId = Number(id);
  if (userId === ctx.user.id) {
    return Response.json({ ok: false, message: "不能对自己执行该操作" }, { status: 400 });
  }
  const target = await getUserById(ctx.db, userId);
  if (!target) return Response.json({ ok: false, message: "用户不存在" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  switch (body.action) {
    case "promote":
      await setUserRole(ctx.db, userId, "admin");
      break;
    case "demote":
      await setUserRole(ctx.db, userId, "user");
      break;
    case "ban":
      await setUserStatus(ctx.db, userId, "banned");
      break;
    case "unban":
      await setUserStatus(ctx.db, userId, "active");
      break;
    case "delete":
      await deleteUserCascade(ctx.db, userId);
      break;
    default:
      return Response.json({ ok: false, message: "未知操作" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
