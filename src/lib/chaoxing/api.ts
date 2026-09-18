import { chaoxingEncrypt } from "../crypto";
import { CxClient, type CookieJar } from "./client";
import { decodeChapterList, decodeCourseList, type ChapterPoint, type CourseInfo } from "./decode";

export interface LoginResult {
  ok: boolean;
  message: string;
  cookies: CookieJar;
  fid: string;
  uid: string;
  name: string;
}

const COMMON_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
};

/** 超星账号密码登录（fanyalogin，AES-CBC 加密） */
export async function chaoxingLogin(phone: string, password: string): Promise<LoginResult> {
  const client = new CxClient({});
  client.setCookie("route", "c1a27d7d75a944a0b85779cb50588996d");
  client.setCookie("platform", "pc");

  const form = {
    fid: "-1",
    uname: chaoxingEncrypt(phone),
    password: chaoxingEncrypt(password),
    refer: "https%3A%2F%2Fi.chaoxing.com",
    t: "true",
    forbidotherlogin: "0",
    validate: "",
    doubleFactorLogin: "0",
    independentId: "0",
  };

  const resp = await client.post("https://passport2.chaoxing.com/fanyalogin", {
    form,
    headers: {
      ...COMMON_HEADERS,
      Origin: "https://passport2.chaoxing.com",
      Referer: "https://passport2.chaoxing.com/login",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 20000,
  });

  let json: { status?: boolean; msg2?: string; msg?: string };
  try {
    json = JSON.parse(resp.text);
  } catch {
    return {
      ok: false,
      message: "登录返回解析失败，可能触发验证码或网络异常",
      cookies: client.jar,
      fid: "",
      uid: "",
      name: "",
    };
  }

  if (json.status === true) {
    const fid = client.getCookie("fid");
    const uid = client.getCookie("_uid") ?? client.getCookie("uid");
    return {
      ok: true,
      message: "登录成功",
      cookies: client.jar,
      fid,
      uid,
      name: client.getCookie("_uname") ?? phone,
    };
  }
  return {
    ok: false,
    message: json.msg2 || json.msg || "账号或密码错误",
    cookies: client.jar,
    fid: "",
    uid: "",
    name: "",
  };
}

/** 获取全部课程（含文件夹内） */
export async function fetchCourseList(cookies: CookieJar): Promise<CourseInfo[]> {
  const client = new CxClient(cookies);
  const url = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata";
  const headers = {
    Host: "mooc2-ans.chaoxing.com",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Origin: "https://mooc2-ans.chaoxing.com",
    Referer:
      "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction?moocDomain=https://mooc1-1.chaoxing.com/mooc-ans",
  };

  const all: CourseInfo[] = [];
  const folderIds: string[] = ["0"];

  // 一级
  const first = await client.post(url, {
    headers,
    form: { courseType: 1, courseFolderId: 0, query: "", superstarClass: 0 },
  });
  if (first.status === 403) throw new ForbiddenError("课程列表返回 403，需要重新登录");
  all.push(...decodeCourseList(first.text));

  // 文件夹
  try {
    const inter = await client.get(
      "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction",
    );
    const re = /fileid="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inter.text)) !== null) if (!folderIds.includes(m[1])) folderIds.push(m[1]);
  } catch {
    // 文件夹解析失败不致命
  }

  for (const fid of folderIds) {
    if (fid === "0") continue;
    const r = await client.post(url, {
      headers,
      form: { courseType: 1, courseFolderId: fid, query: "", superstarClass: 0 },
    });
    if (r.status === 200) all.push(...decodeCourseList(r.text));
  }

  // 去重
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.courseId}-${c.clazzId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface CourseChapter {
  chapterId: string;
  knowledgeId: string;
  title: string;
  locked: boolean;
  /** 章节任务点全部完成（已刷过，可跳过） */
  done?: boolean;
  url: string;
}

/** 获取某门课的章节（任务点入口） */
export async function fetchChapters(
  cookies: CookieJar,
  c: { clazzId: string; courseId: string; cpi: string },
): Promise<{ chapters: CourseChapter[]; diag?: string }> {
  const client = new CxClient(cookies);
  const referer =
    `https://mooc1.chaoxing.com/visit/interaction?clazzid=${c.clazzId}&courseid=${c.courseId}`;

  // 1. 经中间页拿到 enc（302 → mycourse/stu?enc=xxx）
  const midUrl =
    `https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=${c.courseId}` +
    `&clazzid=${c.clazzId}&cpi=${c.cpi}&ismooc2=1&v=2`;
  const mid = await client.get(midUrl, { headers: { Referer: referer } });
  const enc =
    /[?&]enc=([0-9a-f]+)/i.exec(mid.finalUrl)?.[1] ??
    /[?&]enc=([0-9a-f]+)/i.exec(mid.text)?.[1] ??
    "";
  if (!enc) throw new ForbiddenError("获取课程 enc 失败，可能需要重新登录");

  // 2. 拉取章节树页面（studentcourse，注意参数为小写）
  const url =
    `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse` +
    `?courseid=${c.courseId}&clazzid=${c.clazzId}&cpi=${c.cpi}&enc=${enc}`;
  const r = await client.get(url, {
    headers: { Referer: `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu` },
  });
  if (r.status === 403) throw new ForbiddenError("章节列表返回 403");
  const { points, diag } = decodeChapterList(r.text);

  const chapters: CourseChapter[] = [];
  for (const p of points as ChapterPoint[]) {
    const chapterId = p.id || p.knowledgeId;
    if (!chapterId) continue;
    const studyUrl =
      `https://mooc1.chaoxing.com/mooc-ans/course/${c.courseId}.html?clazzid=${c.clazzId}&cpi=${c.cpi}&chapterid=${p.knowledgeId || chapterId}`;
    chapters.push({
      chapterId,
      knowledgeId: p.knowledgeId || chapterId,
      title: p.title || `章节 ${chapterId}`,
      locked: p.locked,
      done: p.done,
      url: studyUrl,
    });
  }
  // 诊断信息（0 章节时日志可定位根因）
  if (chapters.length === 0) {
    const titleM = /<title>([^<]*)<\/title>/i.exec(r.text);
    const clean = r.text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 200);
    return {
      chapters,
      diag: `http=${r.status} ${diag ?? ""} title=${titleM?.[1] ?? "?"} page="${clean}"`,
    };
  }
  return { chapters };
}

/** 获取章节卡片页（含视频/文档/测验任务点参数） */
export async function fetchStudyCard(
  cookies: CookieJar,
  c: { clazzId: string; courseId: string; cpi: string; chapterId: string },
): Promise<{ status: number; html: string; url: string }> {
  const client = new CxClient(cookies);
  // knowledgeCards 接口返回本章任务卡片
  const url =
    `https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?clazzid=${c.clazzId}` +
    `&courseid=${c.courseId}&knowledgeid=${c.chapterId}&cpi=${c.cpi}` +
    `&v=${Date.now()}`;
  const r = await client.get(url, {
    headers: {
      Referer: `https://mooc1.chaoxing.com/mooc-ans/course/${c.courseId}.html`,
    },
  });
  return { status: r.status, html: r.text, url: r.finalUrl };
}
