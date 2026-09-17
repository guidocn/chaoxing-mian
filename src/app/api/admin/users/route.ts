import { listAllCxAccounts, listAllTasks, listUsers } from "@/lib/db/repo";
import { requireAdmin } from "@/lib/server";
import { serializeAdminUser } from "@/lib/serialize";

export const runtime = "edge";

export async function GET() {
  const ctx = await requireAdmin();
  if ("error" in ctx)
    return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const [users, accounts, tasks] = await Promise.all([
    listUsers(ctx.db),
    listAllCxAccounts(ctx.db),
    listAllTasks(ctx.db),
  ]);

  const running = tasks.filter((t) => t.status === "running").length;

  return Response.json({
    ok: true,
    stats: {
      users: users.length,
      accounts: accounts.length,
      tasks: tasks.length,
      running,
      online: accounts.filter((a) => a.login_status === "online").length,
    },
    users: users.map((u) =>
      serializeAdminUser(
        u,
        accounts.filter((a) => a.user_id === u.id).length,
        tasks.filter(
          (t) => t.user_id === u.id && (t.status === "running" || t.status === "paused"),
        ).length,
      ),
    ),
  });
}
