import { requireUser } from "@/lib/server";

export const runtime = "edge";

export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { user } = ctx;
  return Response.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
      status: user.status,
      quota: user.quota,
    },
  });
}
