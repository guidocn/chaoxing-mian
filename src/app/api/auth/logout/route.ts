import { buildClearCookie } from "@/lib/session";

export const runtime = "edge";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": buildClearCookie(),
    },
  });
}
