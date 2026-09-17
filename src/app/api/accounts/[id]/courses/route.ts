import { getCxAccount, listCourses, upsertCourse } from "@/lib/db/repo";
import { fetchCourseList } from "@/lib/chaoxing/api";
import type { CookieJar } from "@/lib/chaoxing/client";
import { requireUser } from "@/lib/server";
import { serializeCourse } from "@/lib/serialize";

export const runtime = "edge";

// 获取已缓存课程
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }
  const courses = await listCourses(ctx.db, account.id);
  return Response.json({
    ok: true,
    loginStatus: account.login_status,
    courses: courses.map(serializeCourse),
  });
}

// 实时拉取超星课程并入库
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });
  const { id } = await params;
  const account = await getCxAccount(ctx.db, Number(id));
  if (!account || account.user_id !== ctx.user.id) {
    return Response.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }
  if (account.login_status !== "online") {
    return Response.json({ ok: false, message: "账号未登录，请先登录超星" }, { status: 400 });
  }
  let cookies: CookieJar = {};
  try {
    cookies = JSON.parse(account.cookies) as CookieJar;
  } catch {
    cookies = {};
  }
  try {
    const list = await fetchCourseList(cookies);
    for (const c of list) {
      await upsertCourse(ctx.db, {
        accountId: account.id,
        courseId: c.courseId,
        clazzId: c.clazzId,
        cpi: c.cpi,
        title: c.title,
        teacher: c.teacher,
      });
    }
    const courses = await listCourses(ctx.db, account.id);
    return Response.json({
      ok: true,
      count: courses.length,
      courses: courses.map(serializeCourse),
    });
  } catch (e) {
    return Response.json(
      { ok: false, message: e instanceof Error ? e.message : "拉取课程失败" },
      { status: 200 },
    );
  }
}
