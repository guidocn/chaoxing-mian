import { getCxAccount, getTaskByAccount } from "@/lib/db/repo";
import { requireUser } from "@/lib/server";
import { fetchVideoConfig, reportVideoHeartbeat } from "@/lib/chaoxing/video";
import type { CookieJar } from "@/lib/chaoxing/client";

export const runtime = "edge";

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

interface EngineStateLite {
  courseIndex: number;
  chapterIndex: number;
  playingTime: number;
  duration: number;
  objectId: string;
  jobid: string;
  otherInfo: string;
  reportUrl: string;
  rt: string;
  dtoken: string;
  fid: string;
  attDurationEnc: string;
  userid: string;
  courses: Array<{ courseId: string; clazzId: string; cpi: string; title: string }>;
  chapters: Array<{ knowledgeId: string; title: string }>;
}

// 临时诊断：对 acc1 的当前任务发起一次真实视频心跳上报（playingTime=30s），
// 用于线上验证新版上报协议是否被超星接受。
export async function GET() {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const account = await getCxAccount(ctx.db, 1);
  if (!account) return Response.json({ ok: false, message: "acc1 不存在" });
  const task = await getTaskByAccount(ctx.db, account.id);
  if (!task) return Response.json({ ok: false, message: "acc1 无任务" });

  const state = safeJson<EngineStateLite>(task.state || "{}", {} as EngineStateLite);
  const course = state.courses?.[state.courseIndex];
  if (!course) return Response.json({ ok: false, message: "state 无课程信息（任务未到 card 阶段）", state });

  const cookies: CookieJar = safeJson<CookieJar>(account.cookies, {});
  const objectId = state.objectId;
  if (!objectId) return Response.json({ ok: false, message: "state 无视频任务（objectId 为空）", state });

  try {
    // 1. 重新拉 dtoken
    const cfg = await fetchVideoConfig(cookies, objectId, state.fid || account.fid || undefined);

    // 2. 发起一次 30s 心跳上报
    const res = await reportVideoHeartbeat(cookies, {
      clazzId: course.clazzId,
      courseId: course.courseId,
      knowledgeId: state.chapters?.[state.chapterIndex]?.knowledgeId || state.otherInfo || "",
      objectId,
      otherInfo: state.otherInfo,
      jobid: state.jobid,
      duration: state.duration || 125,
      speed: Number(task.speed || 2),
      step: 30,
      playingTime: 0,
      reportUrl: state.reportUrl,
      rt: state.rt || "1",
      dtoken: cfg.dtoken || state.dtoken,
      fid: state.fid || account.fid || undefined,
      attDurationEnc: state.attDurationEnc,
      userid: state.userid || account.uid || undefined,
    });

    return Response.json({
      ok: true,
      object_id: objectId,
      course: course.title,
      duration: state.duration,
      state: {
        jobid: state.jobid,
        other_info: state.otherInfo,
        rt: state.rt,
        fid: state.fid || account.fid,
        att_duration_enc: state.attDurationEnc,
        report_url: state.reportUrl,
        clazz_id: course.clazzId,
        course_id: course.courseId,
        userid: state.userid || account.uid,
      },
      status_config: { dtoken_from_status: !!cfg.dtoken, duration_from_status: cfg.duration },
      report: {
        passed: res.passed,
        new_playing_time: res.newPlayingTime,
        finished: res.finished,
        raw: res.raw,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
}
