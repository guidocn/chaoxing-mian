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
  // 课程 cpi（上报 URL 路径 /multimedia/log/a/{cpi}；reportUrl 为空时的正确 fallback）
  cpi?: string;
  // 附件 duration 加密串（attachments.attDurationEnc）
  attDurationEnc?: string;
  // 附加字段（卡片 defaults 里的 userid/rt 等）
  userid?: string;
  // 参数变体（diag/verify 协议对照实验用）：
  // 0=baseline, 1=dtype 小写, 2=clipTime 毫秒, 3=去掉 view=pc, 4=POST, 6=加 mtEnc
  variant?: number;
  // reportBase 变体：0=默认(卡片或 mooc-ans/log/a/{cpi})，1=无 mooc-ans，2=mooc2-ans 域
  base?: number;
}

export interface VideoReportResult {
  // 服务端返回的累计观看时长
  passed: boolean;
  newPlayingTime: number;
  finished: boolean;
  raw: string;
  // 实际请求 URL（diag 诊断用，截断）
  url?: string;
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
export function md5(s: string): string {
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
 * 新版视频心跳上报（严格复刻播放器 videojs-ext 格式）：
 * GET {reportUrl}/{dtoken}?clazzId=...&playingTime=...&duration=...&clipTime=...&objectId=...
 *   &otherInfo=<原始串，不编码>&jobid=...&userid=...&isdrag=0&view=pc&enc=md5(...)&rt=...
 *   &videoFaceCaptureEnc=&dtype=Video&_t=...&attDuration=...&attDurationEnc=...&courseEngineInfo=false
 * 签名：md5("[clazzId][userid][jobid][objectId][playingMs][d_yHJ!$pdA~5][durationMs][clipTime]")
 * 注意：参数顺序必须与播放器一致；otherInfo 含 & 字符时必须原样拼接（服务端按播放器逻辑解析）。
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
  // reportUrl 优先用卡片 defaults；否则用课程真实 cpi（绝不能 fallback 到 0，否则超星不记录学习时间）
  const cpi = p.cpi || "";
  // base：0=默认（卡片 reportUrl 或 mooc1/mooc-ans/log/a/{cpi}），1=无 mooc-ans 前缀，2=mooc2-ans 域
  let reportBase: string;
  if (p.base === 1) {
    reportBase = `https://mooc1.chaoxing.com/multimedia/log/a/${cpi}`;
  } else if (p.base === 2) {
    reportBase = `https://mooc2-ans.chaoxing.com/mooc-ans/multimedia/log/a/${cpi}`;
  } else if (p.reportUrl && p.reportUrl !== "https://mooc1.chaoxing.com/multimedia/log") {
    reportBase = p.reportUrl.replace(/\/+$/, "");
  } else {
    reportBase = `https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/${cpi}`;
  }

  // clipTime：秒级时间区间，形如 0_30；variant=2 时用毫秒
  const clipStr =
    p.variant === 2
      ? `${clipStart * 1000}_${clipEnd * 1000}`
      : `${clipStart}_${clipEnd}`;
  const playMs = clipEnd * 1000;
  const durMs = Math.max(1, p.duration) * 1000;
  const signStr = `[${p.clazzId}][${userid}][${p.jobid}][${p.objectId}][${playMs}][d_yHJ!$pdA~5][${durMs}][${clipStr}]`;
  const enc = md5(signStr);

  // 严格按播放器顺序手写拼接；otherInfo 原始串直接拼（不 URL 编码）
  const otherInfoRaw = p.otherInfo || p.knowledgeId;
  const parts = [
    `clazzId=${p.clazzId}`,
    `playingTime=${clipEnd}`,
    `duration=${p.duration}`,
    `clipTime=${clipStr}`,
    `objectId=${p.objectId}`,
    `otherInfo=${otherInfoRaw}`,
    `jobid=${p.jobid}`,
    `userid=${userid}`,
    `isdrag=0`,
    `view=pc`,
    `enc=${enc}`,
    `rt=${p.rt || "1"}`,
    `videoFaceCaptureEnc=`,
    `dtype=${p.variant === 1 ? "video" : "Video"}`,
    `_t=${Date.now()}`,
    `attDuration=${p.duration}`,
    `attDurationEnc=${p.attDurationEnc || ""}`,
    `courseEngineInfo=false`,
  ];
  // variant=3：去掉 view=pc；variant=6：附加 mtEnc=
  const finalParts =
    p.variant === 3 ? parts.filter((x) => !x.startsWith("view=")) : parts.slice();
  if (p.variant === 6) finalParts.push(`mtEnc=`);
  const url = `${reportBase}/${p.dtoken || ""}?${finalParts.join("&")}`;

  const doSend = async (): Promise<{ status: number; text: string }> => {
    if (p.variant === 4) {
      // POST 变体：参数放 body，form 编码
      const form: Record<string, string> = {};
      for (const kv of finalParts) {
        const i = kv.indexOf("=");
        if (i > 0) form[kv.slice(0, i)] = kv.slice(i + 1);
      }
      const r = await client.post(`${reportBase}/${p.dtoken || ""}`, {
        form,
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://mooc1.chaoxing.com",
          Referer: "https://mooc1.chaoxing.com/ananas/modules/video/index.html",
        },
        timeout: 20000,
      });
      return { status: r.status, text: r.text ?? "" };
    }
    const resp = await client.get(url, {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://mooc1.chaoxing.com",
        Referer: "https://mooc1.chaoxing.com/ananas/modules/video/index.html",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      timeout: 20000,
    });
    return { status: resp.status, text: resp.text ?? "" };
  };

  const { status, text } = await doSend();
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
    raw: `HTTP ${status} ${text.slice(0, 200)}`,
    url: `${reportBase}/${p.dtoken || ""}?${finalParts.join("&").slice(0, 300)}`,
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
  cpiFromUrl: string;
  mid: string;
  /** 任务点是否已完成（卡片 attachments.isPassed） */
  isPassed: boolean;
}

/** 从 start 指向的 { 开始，括号配平提取完整 JSON 对象文本 */
function extractBalancedJson(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * 从卡片 HTML（knowledge/cards）解析视频任务点参数。
 * 新版 cards 页面同时携带：
 *  - mArg = {...attachments:[{jobid, otherInfo, attDurationEnc, objectId, isPassed, ...}]}
 *  - defaults = {...reportUrl, fid, userid, ...}
 */
export function parseVideoTasks(html: string): VideoTaskParsed[] {
  const tasks: VideoTaskParsed[] = [];

  // JSON 直解：新版 cards 接口直接返回 JSON（attachments 数组，键序 headOffset 开头），
  // 正则 attRe 以 {"begins" 开头匹配不到，需先尝试 JSON.parse
  try {
    const trimmed = html.trim();
    if (trimmed.startsWith("{")) {
      const j = JSON.parse(trimmed) as {
        attachments?: Array<Record<string, unknown>>;
        defaults?: Record<string, unknown>;
      };
      const def = j.defaults ?? {};
      const reportUrl =
        (typeof def.reportUrl === "string" ? def.reportUrl : "") ||
        /"reportUrl"\s*:\s*"([^"]+)"/.exec(html)?.[1] ||
        "";
      const fid = (typeof def.fid === "string" ? def.fid : "") || (typeof def.belongschoolid === "string" ? def.belongschoolid : "") || "";
      const userid = (typeof def.userid === "string" ? def.userid : "") || "";
      const cpiFromUrl = /log\/a\/(\d+)/.exec(reportUrl)?.[1] ?? "";
      const atts = j.attachments ?? [];
      for (const a of atts) {
        const objectId = typeof a.objectId === "string" ? a.objectId : "";
        if (!/^[0-9a-f]{20,}$/.test(objectId)) continue;
        const prop = (a.property ?? {}) as Record<string, unknown>;
        tasks.push({
          objectId,
          jobid: typeof a.jobid === "string" ? a.jobid : String(a.jobid ?? ""),
          otherInfo: typeof a.otherInfo === "string" ? a.otherInfo : "",
          rt: "1",
          dtoken: "",
          duration: String(typeof a.attDuration === "number" ? a.attDuration : a.attDuration ?? "0"),
          reportUrl,
          fid,
          attDurationEnc: typeof a.attDurationEnc === "string" ? a.attDurationEnc : "",
          userid,
          cpiFromUrl,
          mid: typeof a.mid === "string" ? a.mid : String(a.mid ?? prop.mid ?? ""),
          isPassed: a.isPassed === true,
        });
      }
      if (tasks.length > 0) return tasks;
    }
  } catch {
    // 非纯 JSON，走 mArg/正则路径
  }

  // mArg 提取：卡片页面标准载体 mArg = {"hiddenConfig":...,"attachments":[...]}
  // attachments 键序以 headOffset 开头（非 {"begins"），attRe 匹配不到，需括号配平提取后 JSON.parse
  try {
    const mArgStart = html.indexOf("mArg = {");
    const startIdx = mArgStart >= 0 ? mArgStart + 7 : html.indexOf("attachments = {") >= 0 ? html.indexOf("attachments = {") + 15 : -1;
    if (startIdx >= 0) {
      const jsonText = extractBalancedJson(html, startIdx);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as {
          attachments?: Array<Record<string, unknown>>;
          defaults?: Record<string, unknown>;
        };
        const def = (parsed.defaults ?? {}) as Record<string, unknown>;
        const reportUrl =
          (typeof def.reportUrl === "string" ? def.reportUrl : "") ||
          /"reportUrl"\s*:\s*"([^"]+)"/.exec(html)?.[1] ||
          "";
        const fid = (typeof def.fid === "string" ? def.fid : "") || (typeof def.belongschoolid === "string" ? def.belongschoolid : "") || "";
        const userid = (typeof def.userid === "string" ? def.userid : "") || "";
        const cpiFromUrl = /log\/a\/(\d+)/.exec(reportUrl)?.[1] ?? "";
        const atts = parsed.attachments ?? [];
        for (const a of atts) {
          const objectId = typeof a.objectId === "string" ? a.objectId : "";
          if (!/^[0-9a-f]{20,}$/.test(objectId)) continue;
          const prop = (a.property ?? {}) as Record<string, unknown>;
          tasks.push({
            objectId,
            jobid: typeof a.jobid === "string" ? a.jobid : String(a.jobid ?? ""),
            otherInfo: typeof a.otherInfo === "string" ? a.otherInfo : "",
            rt: "1",
            dtoken: "",
            duration: String(typeof a.attDuration === "number" ? a.attDuration : a.attDuration ?? "0"),
            reportUrl,
            fid,
            attDurationEnc: typeof a.attDurationEnc === "string" ? a.attDurationEnc : "",
            userid,
            cpiFromUrl,
            mid: typeof a.mid === "string" ? a.mid : String(a.mid ?? prop.mid ?? ""),
            isPassed: a.isPassed === true,
          });
        }
        if (tasks.length > 0) return tasks;
      }
    }
  } catch {
    // mArg 解析失败，走正则路径
  }

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
  // 兜底 1：JSON 顶层 reportUrl（新版 cards 接口直接返回 JSON，无 defaults= 块）
  if (!reportUrl) {
    const jr = /"reportUrl"\s*:\s*"([^"]+)"/.exec(html);
    if (jr) reportUrl = jr[1];
  }
  // 兜底 2：任意位置的多媒体上报路径（含 cpi）
  if (!reportUrl) {
    const lr = /(?:mooc1\.chaoxing\.com)?(\/mooc-ans\/multimedia\/log\/a\/\d+)/.exec(html);
    if (lr) reportUrl = lr[1];
  }
  // cpi 从 reportUrl 反推（log/a/{cpi}），供 fallback 使用
  const cpiFromUrl = /log\/a\/(\d+)/.exec(reportUrl)?.[1] ?? "";

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
    // mid：真实播放器 V2 会话初始化用 mid（initdatawithviewerV2?mid=...）
    const midM = /"mid"\s*:\s*"(\d+)"/.exec(block);
    // 任务点完成状态（超星服务端权威标记）
    const passedM = /"isPassed"\s*:\s*(true|false)/.exec(block);
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
      cpiFromUrl,
      mid: midM?.[1] ?? "",
      isPassed: passedM?.[1] === "true",
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
    const mids = Array.from(html.matchAll(/mid["':=\s]+["']?(\d+)/gi), (m) => m[1]);
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
        cpiFromUrl,
        mid: mids[i] ?? "",
        isPassed: /"isPassed"\s*:\s*true/.test(html),
      });
    }
  }

  return tasks.filter((t) => t.objectId);
}

/**
 * 获取视频配置（dtoken/duration/key）。新版 status 接口需要 k 参数（fid），
 * 否则返回 403。响应含 dtoken/duration/key，无 reportUrl（reportUrl 在卡片 defaults）。
 */
export async function fetchVideoConfig(
  cookies: CookieJar,
  objectId: string,
  fid?: string,
): Promise<{ duration: number; dtoken: string; key: string }> {
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
  let key = "";
  try {
    const j = JSON.parse(r.text) as {
      duration?: string | number;
      dtoken?: string;
      key?: string;
    };
    duration = Number(j.duration ?? 0);
    dtoken = j.dtoken ?? "";
    key = j.key ?? "";
  } catch {
    duration = 0;
  }
  return { duration, dtoken, key };
}

/**
 * 初始化视频观看会话（真实播放器链路）：
 * 1) initdatawithviewerV2?mid={mid}&cpi={cpi}&classid={classId}&courseid={courseId}
 *    必须携带完整浏览器请求头（Referer: video/index.html、Origin、X-Requested-With），
 *    否则 403；V2 是超星 2026-09 新版"会话登记"入口，缺它则心跳 200 但 isPassed 恒 false（不计时长）。
 * 2) getpoints?courseid=&mid= 会话确认（真实播放器顺序：status → initV2 → getpoints → 心跳）。
 */
export async function initVideoSession(
  cookies: CookieJar,
  c: {
    objectId: string;
    mid: string;
    cpi: string;
    clazzId: string;
    courseId: string;
    key: string;
    fid?: string;
  },
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  const client = new CxClient(cookies);
  const k = c.fid || client.getCookie("fid") || "";
  const hdrs = {
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://mooc1.chaoxing.com/ananas/modules/video/index.html",
    Origin: "https://mooc1.chaoxing.com",
    Accept: "application/json, text/javascript, */*; q=0.01",
  };
  // 1. V2 会话初始化（mid 是真实播放器使用的媒体任务 ID）
  const v2Url =
    `https://mooc1.chaoxing.com/mooc-ans/richvideo/initdatawithviewerV2` +
    `?mid=${c.mid}&cpi=${c.cpi}&classid=${c.clazzId}&courseid=${c.courseId}&_dc=${Date.now()}`;
  const r = await client.get(v2Url, { headers: hdrs, timeout: 20000 });
  // 2. getpoints 会话确认
  let gp = { status: 0, text: "" };
  try {
    const gpUrl =
      `https://mooc1.chaoxing.com/ananas/getpoints?courseid=${c.courseId}&mid=${c.mid}&_dc=${Date.now()}`;
    gp = await client.get(gpUrl, { headers: hdrs, timeout: 15000 });
  } catch {
    // getpoints 失败不阻断（V2 成功即可）
  }
  return {
    ok: r.status === 200,
    status: r.status,
    body: (r.text ?? "").slice(0, 200) + ` | getpoints:${gp.status} ${(gp.text ?? "").slice(0, 80)}`,
    url: v2Url,
  };
}
