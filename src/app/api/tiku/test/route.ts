import { NextRequest } from "next/server";
import { testTikuConnection, type TikuConfig, type TikuProvider } from "@/lib/chaoxing/tiku";
import { requireUser } from "@/lib/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    api?: string;
    token?: string;
  };
  const cfg: TikuConfig = {
    provider: (body.provider ?? "none") as TikuProvider,
    api: body.api ?? "",
    token: body.token ?? "",
  };
  const result = await testTikuConnection(cfg);
  return Response.json(result);
}
