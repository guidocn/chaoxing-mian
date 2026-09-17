import { CxClient, type CookieJar } from "./client";

// 视频/音频任务点上报。云函数无长连接，采用"每次 tick 推进一段播放进度"的方式。

export interface VideoTaskParams {
  clazzId: string;
  courseId: string;
  knowledgeId: string;
  objectId: string;
  otherInfo: string;
  jobid: string;
  // 视频总时长（秒）
  duration: number;
  // 倍速
  speed: number;
  // 每次推进秒数（tick 步长，模拟一次心跳播放）
  step: number;
  // 当前已观看秒数（由引擎 state 维护）
  playingTime: number;
  enc?: string;
  reportUrl?: string;
  rt: string;
  dtoken: string;
}

export interface VideoReportResult {
  // 服务端返回的累计观看时长
  passed: boolean;
  newPlayingTime: number;
  finished: boolean;
  raw: string;
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clipTime(t: number): number {
  return Math.max(0, Math.round(t));
}

/**
 * 向 multipart 视频日志接口上报一次心跳。
 * 返回是否成功以及推进后的播放时间。
 */
export async function reportVideoHeartbeat(
  cookies: CookieJar,
  p: VideoTaskParams,
): Promise<VideoReportResult> {
  const client = new CxClient(cookies);
  const isV2 = !!p.reportUrl;
  const targetPlaying = Math.min(p.duration, p.playingTime + p.step);
  const clipTimeStart = clipTime(p.playingTime);
  const clipTimeEnd = clipTime(targetPlaying);
  const started = Date.now();

  const common = {
    clazzId: p.clazzId,
    playingTime: String(clipTimeEnd),
    duration: String(p.duration),
    clipTime: `${clipTimeStart}-${clipTimeEnd}`,
    objectId: p.objectId,
    otherInfo: p.otherInfo || p.knowledgeId,
    jobid: p.jobid,
    userid: client.getCookie("_uid") ?? "",
    rt: p.rt || "0.9",
    dtoken: p.dtoken || "",
    startTime: String(started),
    endTime: String(started + rand(30000, 90000)),
    intsetLock: "0",
  };

  let url: string;
  let form: Record<string, string | number>;

  if (isV2 && p.reportUrl) {
    url = p.reportUrl;
    form = {
      ...common,
      enc: p.enc ?? "",
      v2: "1",
      speed: String(p.speed),
      view: "pc",
      isdrag: "0",
    };
  } else {
    url = "https://mooc1.chaoxing.com/multimedia/log";
    form = {
      ...common,
      enc: p.enc ?? "",
      v2: "1",
    };
  }

  const resp = await client.postNoRedirect(url, {
    form,
    headers: {
      Host: "mooc1.chaoxing.com",
      Origin: "https://mooc1.chaoxing.com",
      Referer: `https://mooc1.chaoxing.com/mooc-ans/course/${p.courseId}.html`,
    },
    timeout: 20000,
  });

  const text = resp.text ?? "";
  let passed = false;
  try {
    const j = JSON.parse(text) as { isPassed?: number | boolean; passed?: boolean };
    passed = j.isPassed === true || j.isPassed === 1 || j.passed === true;
  } catch {
    passed = /true|success|1/.test(text);
  }

  return {
    passed,
    newPlayingTime: targetPlaying,
    finished: targetPlaying >= p.duration,
    raw: text.slice(0, 200),
  };
}

/** 文档/阅读任务点直接上报完成 */
export async function reportDocumentDone(
  cookies: CookieJar,
  p: { clazzId: string; courseId: string; knowledgeId: string; jobid: string; objectId: string },
): Promise<boolean> {
  const client = new CxClient(cookies);
  const url =
    `https://mooc1.chaoxing.com/job/json?jobid=${p.jobid}&clazzid=${p.clazzId}&objectId=${p.objectId}` +
    `&otherInfo=${p.knowledgeId}&courseid=${p.courseId}&jobtype=2&_dc=${Date.now()}`;
  const r = await client.get(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://mooc1.chaoxing.com/mooc-ans/course/${p.courseId}.html`,
    },
  });
  return r.status === 200;
}

/** 从卡片 HTML 中解析视频任务点参数（mArg / getEnc / 视频配置 JSON） */
export function parseVideoTasks(html: string): Array<Record<string, string>> {
  const tasks: Array<Record<string, string>> = [];

  // 形如 mArg = {...}; 或 window.videoConfig = {...}
  const objectRe = /objectId["':\s]+["']?([0-9a-f]{20,})/gi;
  const jobRe = /jobid["':=\s]+["']?([0-9a-f]{8,})/gi;
  const otherRe = /otherInfo["':=\s]+["']?([^"',}\s]{4,})/gi;
  const rtRe = /\brt["':=\s]+["']([\d.]+)["']/i;
  const dtokenRe = /dtoken["':=\s]+["']([0-9a-f]+)["']/i;
  const durationRe = /(?:duration|timeLong|videoTime)["':=\s]+["']?(\d+)/i;

  const objects = Array.from(html.matchAll(objectRe), (m) => m[1]);
  const jobids = Array.from(html.matchAll(jobRe), (m) => m[1]);
  const others = Array.from(html.matchAll(otherRe), (m) => m[1]);
  const len = Math.max(objects.length, jobids.length);
  for (let i = 0; i < len; i++) {
    tasks.push({
      objectId: objects[i] ?? "",
      jobid: jobids[i] ?? "",
      otherInfo: others[i] ?? "",
      rt: rtRe.exec(html)?.[1] ?? "0.9",
      dtoken: dtokenRe.exec(html)?.[1] ?? "",
      duration: durationRe.exec(html)?.[1] ?? "0",
    });
  }
  return tasks.filter((t) => t.objectId);
}

export async function fetchVideoConfig(
  cookies: CookieJar,
  objectId: string,
): Promise<{ duration: number; enc: string; reportUrl: string }> {
  const client = new CxClient(cookies);
  const r = await client.get(
    `https://mooc1.chaoxing.com/ananas/status/${objectId}?_dc=${Date.now()}`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://mooc1.chaoxing.com/",
      },
    },
  );
  let duration = 0;
  let enc = "";
  let reportUrl = "";
  try {
    const j = JSON.parse(r.text) as {
      duration?: string | number;
      dt?: number;
      reportUrl?: string;
      enc?: string;
    };
    duration = Number(j.duration ?? j.dt ?? 0);
    reportUrl = j.reportUrl ?? "";
    enc = j.enc ?? "";
  } catch {
    duration = 0;
  }
  return { duration, enc, reportUrl };
}
