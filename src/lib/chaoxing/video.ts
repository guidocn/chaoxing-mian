import { CxClient, type CookieJar } from "./client";

// 视频/音频任务点上报（新版协议，2026-09 实测）。
// 上报链路：ananas/status 取 dtoken → GET {reportUrl}/{dtoken}?...&enc=md5(signature)

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
  // 学校 fid（status 接口 k 参数；cookie 中为 fid=1888）
  fid?: string;
  // 附件 duration 加密串（attachments.attDurationEnc）
  attDurationEnc?: string;
  // 附加字段（卡片 defaults 里的 userid/rt 等）
  userid?: string;
}

export interface VideoReportResult {
  // 服务端返回的累计观看时长
  passed: boolean;
  newPlayingTime: number;
  finished: boolean;
  raw: string;
}

// 纯 JS MD5（RFC 1321），避免 edge runtime 依赖 node:crypto
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Array<number>(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}
function md5(s: string): string {
  const msg = new TextEncoder().encode(s);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((Math.floor((msg.length + 8) / 64) + 1) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Array<number>(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F = 0, g = 0;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true); odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clipTime(t: number): number {
  return Math.max(0, Math.round(t));
}

/**
 * 新版视频心跳上报：
 * GET {reportUrl}/{dtoken}?clazzId=...&playingTime=...&duration=...&clipTime=...&objectId=...
 *   &otherInfo=...&jobid=...&userid=...&isdrag=0&view=pc&enc=md5(...)&rt=...&dtype=Video
 *   &_t=...&attDuration=...&attDurationEnc=...&courseEngineInfo=false
 * 签名：md5("[clazzId][userid][jobid][objectId][playingMs][d_yHJ!$pdA~5][durationMs][clipTime]")
 */
export async function reportVideoHeartbeat(
  cookies: CookieJar,
  p: VideoTaskParams,
): Promise<VideoReportResult> {
  const client = new CxClient(cookies);
  const targetPlaying = Math.min(p.duration, p.playingTime + p.step);
  const clipStart = clipTime(p.playingTime);
  const clipEnd = clipTime(targetPlaying);
  const userid = p.userid || client.getCookie("_uid") || client.getCookie("UID") || "";
  const fid = p.fid || client.getCookie("fid") || "";
  const reportBase =
    p.reportUrl && p.reportUrl !== "https://mooc1.chaoxing.com/multimedia/log"
      ? p.reportUrl.replace(/\/+$/, "")
      : `https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/${p.clazzId ? "0" : "0"}`;

  // clipTime：秒级时间区间，形如 0_30
  const clipStr = `${clipStart}_${clipEnd}`;
  const playMs = clipEnd * 1000;
  const durMs = Math.max(1, p.duration) * 1000;
  const signStr = `[${p.clazzId}][${userid}][${p.jobid}][${p.objectId}][${playMs}][d_yHJ!$pdA~5][${durMs}][${clipStr}]`;
  const enc = md5(signStr);

  const params = new URLSearchParams({
    clazzId: p.clazzId,
    playingTime: String(clipEnd),
    duration: String(p.duration),
    clipTime: clipStr,
    objectId: p.objectId,
    otherInfo: p.otherInfo || p.knowledgeId,
    jobid: p.jobid,
    userid,
    isdrag: "0",
    view: "pc",
    enc,
    rt: p.rt || "1",
    videoFaceCaptureEnc: "",
    dtype: "Video",
    attDuration: String(p.duration),
    attDurationEnc: p.attDurationEnc || "",
    courseEngineInfo: "false",
  });
  params.set("_t", String(Date.now()));

  const url = `${reportBase}/${p.dtoken || ""}?${params.toString()}`;
  const resp = await client.get(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://mooc1.chaoxing.com/ananas/modules/video/index.html",
    },
    timeout: 20000,
  });

  const text = resp.text ?? "";
  let passed = false;
  try {
    // 响应形如 var d={...isPassed...} 或 {isPassed:...}
    const cleaned = text.replace(/^var\s+d\s*=\s*/, "");
    const j = JSON.parse(cleaned) as Record<string, unknown>;
    const isPassed = j.isPassed ?? j.passed;
    passed = isPassed === true || isPassed === 1 || isPassed === "1" || isPassed === "true";
  } catch {
    passed = /isPassed["':=\s]+(?:true|1)|"status"\s*:\s*"success"/.test(text);
  }

  return {
    passed,
    newPlayingTime: targetPlaying,
    finished: targetPlaying >= p.duration,
    raw: text.slice(0, 300),
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

interface VideoTaskParsed {
  objectId: string;
  jobid: string;
  otherInfo: string;
  rt: string;
  dtoken: string;
  duration: string;
  reportUrl: string;
  fid: string;
  attDurationEnc: string;
  userid: string;
}

/**
 * 从卡片 HTML（knowledge/cards）解析视频任务点参数。
 * 新版 cards 页面同时携带：
 *  - mArg = {...attachments:[{jobid, otherInfo, attDurationEnc, objectId, ...}]}
 *  - defaults = {...reportUrl, fid, userid, ...}
 */
export function parseVideoTasks(html: string): VideoTaskParsed[] {
  const tasks: VideoTaskParsed[] = [];

  // defaults 里的 reportUrl / fid / userid
  let reportUrl = "";
  let fid = "";
  let userid = "";
  const defRe = /defaults\s*=\s*(\{[\s\S]*?\})\s*[;,<]/;
  const defM = defRe.exec(html);
  if (defM) {
    try {
      const d = JSON.parse(defM[1]) as Record<string, string>;
      reportUrl = d.reportUrl ?? "";
      fid = d.fid ?? d.belongschoolid ?? "";
      userid = d.userid ?? "";
    } catch {
      // 忽略 defaults 解析失败
    }
  }

  // attachments 视频条目（优先，字段最全）
  const attRe = /\{\s*"begins"[\s\S]*?"objectId"\s*:\s*"([0-9a-f]+)"[\s\S]*?\}/g;
  let attM: RegExpExecArray | null;
  while ((attM = attRe.exec(html)) !== null) {
    const block = attM[0];
    const jobM = /"jobid"\s*:\s*"(\d+)"/.exec(block);
    const objM = /"objectId"\s*:\s*"([0-9a-f]+)"/.exec(block);
    const otherM = /"otherInfo"\s*:\s*"([^"]+)"/.exec(block);
    const attDurM = /"attDurationEnc"\s*:\s*"([0-9a-f]+)"/.exec(block);
    const attDur = /"attDuration"\s*:\s*(\d+)/.exec(block);
    if (!objM) continue;
    tasks.push({
      objectId: objM[1],
      jobid: jobM?.[1] ?? "",
      otherInfo: otherM?.[1] ?? "",
      rt: "1",
      dtoken: "",
      duration: attDur?.[1] ?? "0",
      reportUrl,
      fid,
      attDurationEnc: attDurM?.[1] ?? "",
      userid,
    });
  }

  // 兜底：video 任务块正则（含 property.module=insertvideo）
  if (tasks.length === 0) {
    const objectRe = /objectId["':\s]+["']?([0-9a-f]{20,})/gi;
    const jobRe = /jobid["':=\s]+["']?([0-9a-f]{8,})/gi;
    const otherRe = /otherInfo["':=\s]+["']?([^"',}\s]{4,})/gi;
    const rtRe = /\brt["':=\s]+["']([\d.]+)["']/i;
    const durationRe = /(?:duration|timeLong|videoTime)["':=\s]+["']?(\d+)/i;
    const attDurEncRe = /attDurationEnc["':=\s]+["']([0-9a-f]+)["']/i;

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
        dtoken: "",
        duration: durationRe.exec(html)?.[1] ?? "0",
        reportUrl,
        fid,
        attDurationEnc: attDurEncRe.exec(html)?.[1] ?? "",
        userid,
      });
    }
  }

  return tasks.filter((t) => t.objectId);
}

/**
 * 获取视频配置（dtoken/duration）。新版 status 接口需要 k 参数（fid），
 * 否则返回 403。响应含 dtoken/duration，无 reportUrl（reportUrl 在卡片 defaults）。
 */
export async function fetchVideoConfig(
  cookies: CookieJar,
  objectId: string,
  fid?: string,
): Promise<{ duration: number; dtoken: string }> {
  const client = new CxClient(cookies);
  const k = fid || client.getCookie("fid") || "";
  const r = await client.get(
    `https://mooc1.chaoxing.com/ananas/status/${objectId}?k=${k}&flag=normal&ro=0&_dc=${Date.now()}`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://mooc1.chaoxing.com/",
      },
    },
  );
  let duration = 0;
  let dtoken = "";
  try {
    const j = JSON.parse(r.text) as {
      duration?: string | number;
      dtoken?: string;
    };
    duration = Number(j.duration ?? 0);
    dtoken = j.dtoken ?? "";
  } catch {
    duration = 0;
  }
  return { duration, dtoken };
}
