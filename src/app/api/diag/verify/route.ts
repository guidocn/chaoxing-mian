import { getCxAccount, getTaskByAccount } from "@/lib/db/repo";
import { requireUser } from "@/lib/server";
import { fetchVideoConfig, initVideoSession, reportVideoHeartbeat, parseVideoTasks, md5 } from "@/lib/chaoxing/video";
import { fetchChapters, fetchStudyCard } from "@/lib/chaoxing/api";
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
  courses: Array<{ courseId: string; clazzId: string; cpi: string; title: string }>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 完整视频协议验证器（临时诊断接口，验证后应删）：
 * GET /api/diag/verify?course=0&fast=1&variant=0&maxScan=30
 *   course  课程索引（state.courses 内）
 *   fast    1=快速模拟（间隔 1s，步进 25s）；0=真实节奏（间隔 25s，很慢）
 *   variant 心跳参数变体：0 baseline / 1 dtype小写 / 2 clipTime毫秒 / 3 去view=pc / 4 POST / 6 加mtEnc
 *   maxScan 最多扫描章节数（找第一个真视频）
 * 流程：拉章节→拉卡片→解析视频任务→status 取真 duration→完整心跳直到播满→返回每轮结果与最终 isPassed。
 */
export async function GET(request: Request) {
  const ctx = await requireUser();
  if ("error" in ctx) return Response.json({ ok: false, message: ctx.error }, { status: ctx.status });

  const account = await getCxAccount(ctx.db, 1);
  if (!account) return Response.json({ ok: false, message: "acc1 不存在" });
  const task = await getTaskByAccount(ctx.db, account.id);
  if (!task) return Response.json({ ok: false, message: "acc1 无任务" });

  const state = safeJson<EngineStateLite>(task.state || "{}", {} as EngineStateLite);
  const courses = state.courses || [];
  if (courses.length === 0)
    return Response.json({ ok: false, message: "state 无课程（先重置并开始一次任务）" });

  const u = new URL(request.url);
  const courseIdx = Math.min(Number(u.searchParams.get("course") ?? "0"), courses.length - 1);
  const fast = u.searchParams.get("fast") !== "0";
  const variant = Number(u.searchParams.get("variant") ?? "0");
  const maxScan = Number(u.searchParams.get("maxScan") ?? "12");
  // 心跳间隔：默认 25s（真实节奏，避免 WAF 限流 403）；fast=1 时仍建议 ≥5s
  const gap = Number(u.searchParams.get("gap") ?? (fast ? "5" : "25"));
  const step = Number(u.searchParams.get("step") ?? "25");
  // Pages Function 网关限制单请求时长：强制单轮（25s），多轮用 from= 续播；diag=1 秒回
  const maxRounds = u.searchParams.get("diag") === "1" ? 0 : 1;
  const fmt = u.searchParams.get("fmt") ?? "json";
  const course = courses[courseIdx];
  const cookies: CookieJar = safeJson<CookieJar>(account.cookies, {});

  // 1. 拉章节
  let chapters: Array<{ knowledgeId: string; title: string }> = [];
  try {
    chapters = await fetchChapters(cookies, {
      clazzId: course.clazzId,
      courseId: course.courseId,
      cpi: course.cpi,
    });
  } catch (e) {
    return Response.json({ ok: false, message: `拉章节失败: ${e instanceof Error ? e.message : e}` });
  }
  const scan = chapters.slice(0, maxScan);

  // 2. 逐章扫卡片，找真视频
  const found: Array<{
    chapterTitle: string;
    knowledgeId: string;
    objectId: string;
    jobid: string;
    otherInfo: string;
    reportUrl: string;
    cpi: string;
    fid: string;
    attDurationEnc: string;
    userid: string;
    duration: number;
    dtoken: string;
    key?: string;
    cardStatus: number;
    cardDiag?: { has_defaults: boolean; has_report_url: boolean; has_log_a: boolean; html_len: number };
  }> = [];
  for (const ch of scan) {
    const card = await fetchStudyCard(cookies, {
      clazzId: course.clazzId,
      courseId: course.courseId,
      cpi: course.cpi,
      chapterId: ch.knowledgeId,
    });
    if (card.status !== 200) continue;
    const videos = parseVideoTasks(card.html);
    for (const v of videos) {
      const cfg = await fetchVideoConfig(cookies, v.objectId, v.fid || account.fid || undefined);
      if (cfg.duration && cfg.duration >= 10 && cfg.duration <= 900) {
        found.push({
          chapterTitle: ch.title,
          knowledgeId: ch.knowledgeId,
          objectId: v.objectId,
          jobid: v.jobid,
          otherInfo: v.otherInfo || ch.knowledgeId,
          reportUrl: v.reportUrl,
          // cpi 优先用卡片 log/a 路径反推的真实 cpi，其次课程 cpi
          cpi: v.cpiFromUrl || course.cpi,
          fid: v.fid || account.fid || "1888",
          attDurationEnc: v.attDurationEnc || "",
          userid: v.userid || account.uid || "",
          duration: cfg.duration,
          dtoken: cfg.dtoken || "",
          key: cfg.key,
          cardStatus: card.status,
          // 诊断：卡片 HTML 里 defaults / reportUrl 的原始证据
          cardDiag: {
            has_defaults: /defaults\s*=/.test(card.html),
            has_report_url: /reportUrl/.test(card.html),
            has_log_a: /multimedia\/log/.test(card.html),
            html_len: card.html.length,
          },
        });
        break;
      }
    }
    if (found.length >= 8) break;
    // 扫描限速：避免连续请求触发超星风控
    await sleep(800);
  }
  if (found.length === 0)
    return Response.json({
      ok: false,
      message: `前 ${maxScan} 章未找到真视频（10-900s）`,
      scanned: scan.length,
      chapters_total: chapters.length,
    });

  // 可选视频：?video=N 选第 N 个（默认 0）；diag=1 时列出前 8 个
  const videoIdx = Math.min(Number(u.searchParams.get("video") ?? "0"), found.length - 1);
  if (u.searchParams.get("diag") === "1") {
    const lines = [
      `找到 ${found.length} 个真视频（共扫 ${scan.length} 章）：`,
      ...found.map((f, i) => `${i}. ${f.chapterTitle} | ${f.objectId} | ${f.duration}s | jobid=${f.jobid} | cpi=${f.cpi}`),
      ``,
      `当前默认选第 ${videoIdx} 个（${found[videoIdx].chapterTitle}）`,
      `选其他视频: 加 &video=N（如 &video=1 选第 2 个）`,
    ];
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const v = found[videoIdx];

  // 3. 初始化观看会话
  let init = null;
  if (v.key) {
    try {
      init = await initVideoSession(cookies, v.objectId, v.key, v.fid);
    } catch (e) {
      init = { status: 0, ok: false, body: String(e), url: "" };
    }
  }

  // 4. 完整心跳直到播满（from 支持分轮续播：?from=50 从 50s 继续）
  //    diag=1 纯诊断模式：不跑心跳，直接输出视频信息 + 构造的 URL 预览（秒回）
  const rounds: Array<{ t: number; playingTime: number; passed: boolean; raw: string; url: string }> = [];
  let playing = Number(u.searchParams.get("from") ?? "0");
  let finished = false;
  let guard = 0;
  const diagOnly = u.searchParams.get("diag") === "1";
  if (diagOnly) {
    // 模拟一次心跳的 URL（playingTime 从 from 或 0 起步），不实际发送
    const targetPlaying = Math.min(v.duration, playing + step);
    const clipStr = `${playing}_${targetPlaying}`;
    const playMs = targetPlaying * 1000;
    const durMs = Math.max(1, v.duration) * 1000;
    const enc = md5(
      `[${course.clazzId}][${v.userid}][${v.jobid}][${v.objectId}][${playMs}][d_yHJ!$pdA~5][${durMs}][${clipStr}]`,
    );
    const base =
      v.reportUrl && v.reportUrl !== "https://mooc1.chaoxing.com/multimedia/log"
        ? v.reportUrl.replace(/\/+$/, "")
        : `https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/${v.cpi}`;
    rounds.push({
      t: 1,
      playingTime: targetPlaying,
      passed: false,
      raw: "(诊断模式未发送)",
      url: `${base}/${v.dtoken}?clazzId=${course.clazzId}&playingTime=${targetPlaying}&duration=${v.duration}&clipTime=${clipStr}&objectId=${v.objectId}&otherInfo=${v.otherInfo}&jobid=${v.jobid}&userid=${v.userid}&isdrag=0&view=pc&enc=${enc}&rt=1&videoFaceCaptureEnc=&dtype=Video&_t=0&attDuration=${v.duration}&attDurationEnc=${v.attDurationEnc}&courseEngineInfo=false`,
    });
  }
  while (guard < maxRounds && !diagOnly) {
    guard += 1;
    await sleep(gap * 1000);
    const res = await reportVideoHeartbeat(cookies, {
      clazzId: course.clazzId,
      courseId: course.courseId,
      knowledgeId: v.knowledgeId,
      objectId: v.objectId,
      otherInfo: v.otherInfo,
      jobid: v.jobid,
      duration: v.duration,
      speed: 1,
      step,
      playingTime: playing,
      reportUrl: v.reportUrl,
      rt: "1",
      dtoken: v.dtoken,
      fid: v.fid,
      attDurationEnc: v.attDurationEnc,
      userid: v.userid,
      cpi: v.cpi,
      variant,
      base: Number(u.searchParams.get("base") ?? "0"),
    });
    playing = res.newPlayingTime;
    rounds.push({
      t: rounds.length + 1,
      playingTime: playing,
      passed: res.passed,
      raw: res.raw.slice(0, 180),
      url: (res as unknown as { url?: string }).url || "",
    });
    if (res.passed || res.finished) {
      finished = res.finished;
      break;
    }
    if (playing >= v.duration) break;
  }

  const result = {
    ok: true,
    course: course.title,
    cpi: v.cpi,
    course_id: course.courseId,
    clazz_id: course.clazzId,
    video: {
      chapter: v.chapterTitle,
      object_id: v.objectId,
      jobid: v.jobid,
      duration: v.duration,
      dtoken_from_status: !!v.dtoken,
      key_from_status: !!v.key,
      fid: v.fid,
      userid: v.userid,
      att_duration_enc: v.attDurationEnc,
      report_url: v.reportUrl,
      card_status: v.cardStatus,
      card_diag: v.cardDiag,
    },
    init_session: init ? { status: init.status, ok: init.ok, body: init.body?.slice(0, 120) } : "no-key",
    variant,
    gap,
    rounds,
    final: {
      passed: rounds.some((r) => r.passed),
      finished,
      last_playing_time: playing,
    },
    note: "isPassed=true 表示协议被超星确认；HTTP 403 多为风控限流（间隔太小），可加大 gap；false 表示被接受但未达完成判定，需换 variant",
  };

  if (fmt === "text") {
    const lines = [
      `课程: ${result.course}`,
      `章节: ${v.chapterTitle}`,
      `objectId: ${v.objectId}  cpi: ${v.cpi}  clazzId: ${course.clazzId}`,
      `duration: ${v.duration}s  jobid: ${v.jobid}`,
      `fid: ${v.fid}  userid: ${v.userid}`,
      `attDurationEnc: ${v.attDurationEnc || "(空)"}`,
      `reportUrl: ${v.reportUrl || "(空→fallback)"}`,
      `卡片诊断: defaults=${v.cardDiag?.has_defaults} reportUrl字段=${v.cardDiag?.has_report_url} log/a=${v.cardDiag?.has_log_a} 卡片长度=${v.cardDiag?.html_len}`,
      `init: ${init ? `${init.status} ${init.ok}` : "no-key"} ${init?.body?.slice(0, 80) || ""}`,
      `variant: ${variant}  gap: ${gap}s  step: ${step}s  from: ${Math.max(0, playing - guard * step)}s`,
      ...rounds.map(
        (r) => `轮${r.t} | 播到${r.playingTime}s | ${r.passed ? "通过✓" : "未通过✗"} | ${r.raw.replace(/\n/g, " ")}\n  URL: ${r.url}`,
      ),
      `最终: ${result.final.passed ? "通过✓" : "未通过✗"} 播满=${result.final.finished}`,
      `续播: /api/diag/verify?course=${courseIdx}&variant=${variant}&gap=${gap}&step=${step}&from=${playing}&fmt=text`,
    ];
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
