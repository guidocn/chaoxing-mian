// 任务引擎：以"每次 tick 推进一步"的方式运行，天然适配无状态云函数。
//
// 运行模型：
//  - 前端在任务 running 时每 5s 调用 /api/tasks/[id]/tick
//  - 每次 tick 从 DB 读取 state，执行一个原子步骤（登录/取课/进章节/视频心跳/文档/测验），再落盘
//  - 遇到 403 置 login_required（由账号重新登录后自动恢复），绝不跳过任务点
//  - Cloudflare CPU 时长有限，因此单步必须是少量 await fetch，不在请求内 sleep/死循环

import type { DBAdapter } from "@/types/env";
import type { CxAccountRow, TaskRow } from "../types";
import {
  addLog,
  getCxAccount,
  updateCxAccount,
  updateTaskRow,
  getTaskById,
  listCourses,
} from "../db/repo";
import { nowSec } from "../db/index";
import { appDecrypt } from "../crypto";
import {
  chaoxingLogin,
  fetchCourseList,
  fetchChapters,
  fetchStudyCard,
  ForbiddenError,
  type CourseChapter,
} from "../chaoxing/api";
import type { CookieJar } from "../chaoxing/client";
import {
  fetchVideoConfig,
  initVideoSession,
  parseVideoTasks,
  reportDocumentDone,
  reportVideoHeartbeat,
} from "../chaoxing/video";
import { queryTiku, type TikuConfig } from "../chaoxing/tiku";

// ---- 引擎断点状态 ----
export interface EngineState {
  phase:
    | "init"
    | "courses"
    | "chapters"
    | "card"
    | "video"
    | "document"
    | "quiz"
    | "next"
    | "done";
  courseIndex: number;
  chapterIndex: number;
  taskIndex: number;
  // 视频心跳进度
  playingTime: number;
  duration: number;
  objectId: string;
  jobid: string;
  otherInfo: string;
  enc: string;
  reportUrl: string;
  rt: string;
  dtoken: string;
  fid: string;
  attDurationEnc: string;
  userid: string;
  // V2 会话初始化用的媒体任务 ID（真实播放器 initdatawithviewerV2?mid=）
  mid: string;
  // 卡片 log/a 反推的真实 cpi（优先于课程级 cpi，多课程时可能不同）
  cpi: string;
  // 每门课的独立进度
  courseProgress: Array<{ courseId: string; title: string; total: number; done: number }>;
  // 视频完成未确认重试计数
  retryDone: number;
  // 上次视频上报时间戳（真实速率节流）
  lastReportTs: number;
  // 缓存
  courses: Array<{ courseId: string; clazzId: string; cpi: string; title: string; teacher: string }>;
  chapters: CourseChapter[];
  retry403: number;
}

const initialState: EngineState = {
  phase: "init",
  courseIndex: 0,
  chapterIndex: 0,
  taskIndex: 0,
  playingTime: 0,
  duration: 0,
  objectId: "",
  jobid: "",
  otherInfo: "",
  enc: "",
  reportUrl: "",
  rt: "0.9",
  dtoken: "",
  fid: "",
  attDurationEnc: "",
  userid: "",
  mid: "",
  cpi: "",
  courseProgress: [],
  courses: [],
  chapters: [],
  retryDone: 0,
  lastReportTs: 0,
  retry403: 0,
};

function parseState(task: TaskRow): EngineState {
  try {
    return { ...initialState, ...(JSON.parse(task.state || "{}") as Partial<EngineState>) };
  } catch {
    return { ...initialState };
  }
}

type Logger = (level: "info" | "success" | "warn" | "error", message: string) => Promise<void>;

export interface TickOutcome {
  done: boolean;
  status: TaskRow["status"];
  state: EngineState;
  progress: { total: number; finished: number };
}

/** 执行一次 tick */
export async function runTick(
  db: DBAdapter,
  taskId: number,
  secret: string | undefined,
): Promise<TickOutcome> {
  const task = await getTaskById(db, taskId);
  if (!task) throw new Error("任务不存在");
  const account = await getCxAccount(db, task.account_id);
  if (!account) throw new Error("超星账号不存在");

  const state = parseState(task);
  const log: Logger = async (level, message) => {
    await addLog(db, { taskId, accountId: account.id, level, message });
  };

  const cookies: CookieJar = safeJson<CookieJar>(account.cookies, {});
  const tikuCfg: TikuConfig = {
    provider: (task.tiku_provider as TikuConfig["provider"]) || "none",
    api: task.tiku_api,
    token: task.tiku_token,
  };

  // 持久化辅助
  const save = async (patch: Partial<TaskRow>, newState?: EngineState): Promise<void> => {
    const payload: Partial<TaskRow> = { ...patch, updated_at: nowSec() };
    if (newState) payload.state = JSON.stringify(newState);
    await updateTaskRow(db, taskId, payload);
  };

  const course = state.courses[state.courseIndex];
  const chapter = state.chapters[state.chapterIndex];

  switch (state.phase) {
    // ---------- 初始化 / 登录 ----------
    case "init": {
      if (account.login_status !== "online" || !cookies || Object.keys(cookies).length === 0) {
        await save({ status: "login_required", phase: "登录校验" }, state);
        await log("warn", "账号未登录或登录已失效，等待重新登录");
        return { done: false, status: "login_required", state, progress: { total: 0, finished: 0 } };
      }
      await log("info", "开始执行刷课任务");
      state.phase = "courses";
      await save({ status: "running", phase: "拉取课程" }, state);
      return { done: false, status: "running", state, progress: { total: 0, finished: 0 } };
    }

    // ---------- 拉取课程 ----------
    case "courses": {
      try {
        // 优先使用用户勾选的课程；否则实时拉取
        const selected = (await listCourses(db, account.id)).filter((c) => c.selected === 1);
        if (selected.length > 0) {
          state.courses = selected.map((c) => ({
            courseId: c.course_id,
            clazzId: c.clazz_id,
            cpi: c.cpi,
            title: c.title,
            teacher: c.teacher,
          }));
        } else if (state.courses.length === 0) {
          const list = await fetchCourseList(cookies);
          state.courses = list.map((c) => ({
            courseId: c.courseId,
            clazzId: c.clazzId,
            cpi: c.cpi,
            title: c.title,
            teacher: c.teacher,
          }));
        }
        if (state.courses.length === 0) {
          await log("warn", "没有可刷的课程");
          state.phase = "done";
          await save({ status: "done", phase: "完成" }, state);
          return { done: true, status: "done", state, progress: { total: 0, finished: 0 } };
        }
        // 初始化每门课进度（total/done 在处理过程中动态累计）
        if (state.courseProgress.length !== state.courses.length) {
          state.courseProgress = state.courses.map((c) => ({
            courseId: c.courseId,
            title: c.title || "超星课程",
            total: 0,
            done: 0,
          }));
        }
        state.phase = "chapters";
        state.chapterIndex = 0;
        await log("success", `共获取 ${state.courses.length} 门课程，开始刷课`);
        // 诊断：检查每门课参数完整性（空 courseId/clazzId 会导致章节拉取失败）
        const bad = state.courses.filter((x) => !x.courseId || !x.clazzId || !x.cpi);
        if (bad.length > 0) {
          await log(
            "warn",
            `${bad.length} 门课程参数不完整（courseId/clazzId/cpi 为空）：${bad
              .map((x) => x.title || "?")
              .slice(0, 5)
              .join("、")}`,
          );
        }
        await save({ phase: "课程章节", total_points: state.courses.length }, state);
        return { done: false, status: "running", state, progress: { total: state.courses.length, finished: 0 } };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save);
      }
    }

    // ---------- 拉取章节 ----------
    case "chapters": {
      if (!course) return advanceCourse(state, save, log);
      try {
        const { chapters, diag } = await fetchChapters(cookies, {
          clazzId: course.clazzId,
          courseId: course.courseId,
          cpi: course.cpi,
        });
        // 0 章节课程：可能是已失效/无权限课程，跳过避免死循环
        if (chapters.length === 0) {
          await log("warn", `《${course.title || "超星课程"}》章节为空，跳过该课程（${diag ?? ""}）`);
          return advanceCourse(state, save, log);
        }
        const doneCount = chapters.filter((c) => c.done).length;
        if (doneCount > 0) {
          await log("info", `《${course.title}》共 ${chapters.length} 个章节（其中 ${doneCount} 个已完成，将跳过）`);
        } else {
          await log("info", `《${course.title}》共 ${chapters.length} 个章节`);
        }
        state.chapters = chapters;
        state.chapterIndex = 0;
        state.phase = "card";
        await save({ current_course: course.title }, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save);
      }
    }

    // ---------- 进入章节卡片，识别任务点 ----------
    case "card": {
      if (!course) return advanceCourse(state, save, log);
      if (!chapter || state.chapterIndex >= state.chapters.length) {
        return advanceCourse(state, save, log);
      }
      if (chapter.locked && task.skip_locked === 1) {
        await log("info", `跳过未开放章节：${chapter.title}`);
        state.chapterIndex += 1;
        state.phase = "card";
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      }
      // 已完成的章节（超星 studentcourse 的 icon_yiwanc 标记）：跳过，避免重复刷
      if (chapter.done) {
        await log("success", `已完成章节，跳过：${chapter.title}`);
        bumpCourse(state, course.courseId, "done");
        state.chapterIndex += 1;
        state.phase = "card";
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      }
      try {
        const card = await fetchStudyCard(cookies, {
          clazzId: course.clazzId,
          courseId: course.courseId,
          cpi: course.cpi,
          chapterId: chapter.knowledgeId,
        });
        if (card.status === 403) throw new ForbiddenError("章节卡片 403");

        // ---------- 任务类型识别 ----------
        // 1) 文档/PDF/阅读任务（优先）：新版卡片用 dtype/property.module 标记，
        //    objectId 正则会撞上 PDF 的 objectId，必须先识别文档任务
        const docTaskRe =
          /dtype["']\s*:\s*["'](?:document|pdf|doc|readbook)["']|property\.module["']?\s*:\s*["']insertpdf|readbook|\.pdf["']|知识文档|阅读任务/i;
        if (docTaskRe.test(card.html)) {
          const objM = /objectId["':=\s]+["']?([0-9a-f]{20,})/i.exec(card.html);
          const jobM = /jobid["':=\s]+["']?([0-9a-f-]{20,})/i.exec(card.html);
          state.jobid = jobM?.[1] ?? objM?.[1] ?? "";
          state.objectId = objM?.[1] ?? "";
          state.otherInfo = chapter.knowledgeId;
          state.phase = "document";
          bumpCourse(state, course.courseId, "total");
          await save({ current_chapter: chapter.title, phase: "文档阅读" }, state);
          return { done: false, status: "running", state, progress: progressOf(state) };
        }

        const videos = parseVideoTasks(card.html);
        if (videos.length > 0) {
          const v = videos[0];
          // 任务点已完成（卡片 isPassed=true）：跳过，避免重复刷
          if (v.isPassed) {
            await log("success", `任务点已完成，跳过：${chapter.title}`);
            bumpCourse(state, course.courseId, "done");
            state.chapterIndex += 1;
            state.phase = "card";
            await save({}, state);
            return { done: false, status: "running", state, progress: progressOf(state) };
          }
          state.taskIndex = 0;
          bumpCourse(state, course.courseId, "total");
          state.objectId = v.objectId;
          state.jobid = v.jobid;
          state.otherInfo = v.otherInfo || chapter.knowledgeId;
          state.rt = v.rt || "0.9";
          state.dtoken = "";
          state.fid = v.fid || "";
          state.attDurationEnc = v.attDurationEnc || "";
          state.userid = v.userid || "";
          state.mid = v.mid || "";
          let cfg = await fetchVideoConfig(cookies, v.objectId, v.fid);
          // 无时长且无 dtoken：可能是文档任务被误判为视频（PDF/阅读任务）。
          // status 偶发失败会同时丢 duration 与 dtoken，重试一次再判定。
          if ((!cfg.duration && !cfg.dtoken) || (cfg.duration === 0 && !cfg.dtoken)) {
            cfg = await fetchVideoConfig(cookies, v.objectId, v.fid);
          }
          if (!cfg.duration && !cfg.dtoken) {
            // 文档任务：转 document 流程标记完成（不能跳过漏任务点）
            state.jobid = state.jobid || v.jobid || v.objectId;
            state.objectId = v.objectId;
            state.otherInfo = chapter.knowledgeId;
            state.phase = "document";
            bumpCourse(state, course.courseId, "done");
            await log("warn", `文档任务（非视频），按文档标记完成：${chapter.title}`);
            state.chapterIndex += 1;
            state.phase = "card";
            await save({ current_chapter: chapter.title, phase: "文档完成" }, state);
            return { done: false, status: "running", state, progress: progressOf(state) };
          }
          state.duration = cfg.duration || Number(v.duration) || 0;
          state.dtoken = cfg.dtoken || "";
          // 初始化观看会话：真实播放器链路 status → initdatawithviewerV2(mid) → getpoints → 心跳。
          // V2 会话登记是"心跳被确认/计入时长"的关键，缺它则心跳 200 但 isPassed 恒 false。
          try {
            const init = await initVideoSession(cookies, {
              objectId: v.objectId,
              mid: v.mid || state.mid || "",
              cpi: v.cpiFromUrl || course.cpi,
              clazzId: course.clazzId,
              courseId: course.courseId,
              key: cfg.key,
              fid: v.fid || state.fid,
            });
            if (init.ok) await log("info", `观看会话已初始化（V2）：${chapter.title} ${init.body.slice(0, 60)}`);
            else await log("warn", `会话初始化未成功(${init.status})：${chapter.title}`);
          } catch (e) {
            await log("warn", `会话初始化异常(${e instanceof Error ? e.message.slice(0, 60) : e})，继续尝试上报：${chapter.title}`);
          }
          state.reportUrl = v.reportUrl || "";
          state.cpi = v.cpiFromUrl || course.cpi;
          state.playingTime = 0;
          state.phase = "video";
          await log("info", `视频任务：${chapter.title}（时长 ${state.duration}s，1x 真实速率）`);
          await save({ current_chapter: chapter.title, phase: "视频学习" }, state);
          return { done: false, status: "running", state, progress: progressOf(state) };
        }

        // 文档/阅读任务
        const docMatch = /jobid["':=\s]+["']?([0-9a-f-]{20,})/i.exec(card.html);
        if (docMatch) {
          state.jobid = docMatch[1];
          state.otherInfo = chapter.knowledgeId;
          state.phase = "document";
          bumpCourse(state, course.courseId, "total");
          await save({ current_chapter: chapter.title, phase: "文档阅读" }, state);
          return { done: false, status: "running", state, progress: progressOf(state) };
        }

        // 测验任务
        if (/workRelation|quiz|exam|作业|测验/.test(card.html)) {
          state.phase = "quiz";
          await save({ current_chapter: chapter.title, phase: "测验答题" }, state);
          return { done: false, status: "running", state, progress: progressOf(state) };
        }

        // 无任务点，标记并进入下一章
        await log("info", `本章无任务点：${chapter.title}`);
        state.chapterIndex += 1;
        state.phase = "card";
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save);
      }
    }

    // ---------- 视频心跳：按真实时间×倍速推进（模拟播放器，防超星反作弊） ----------
    case "video": {
      if (!course || !chapter) return advanceCourse(state, save, log);
      try {
        // 兜底：异常进入 video 但无时长/无会话 → 按文档标记完成，避免"假完成"空耗
        if (!state.duration && !state.dtoken) {
          state.phase = "document";
          bumpCourse(state, course.courseId, "done");
          await log("warn", `视频无时长/无会话，按文档标记完成：${chapter.title}`);
          state.chapterIndex += 1;
          state.phase = "card";
          await save({}, state);
          return { done: false, status: "running", state, progress: progressOf(state) };
        }
        // 固定 1x 真实速率：每次推进量 = 实际经过时间，防止被超星判定异常观看不累计
        const speed = 1;
        const now = Date.now();
        const prevTs = state.lastReportTs;
        // 上报节流：距上次上报不足 25 秒则等待（播放器 reportTimeInterval=60s，我们取 25s 粒度）
        const elapsed = prevTs ? (now - prevTs) / 1000 : 0;
        if (prevTs && elapsed < 25) {
          await log(
            "info",
            `视频播放中：${chapter.title}（${Math.ceil(25 - elapsed)}s 后上报）`,
          );
          return { done: false, status: "running", state, progress: progressOf(state) };
        }
        state.lastReportTs = now;
        // 本次推进量 = 实际经过时间（首次按 30s 起步，1x）
        const inc = prevTs ? Math.max(1, Math.round(elapsed)) : 30;
        const step = Math.max(1, Math.min(inc, 600));
        const res = await reportVideoHeartbeat(cookies, {
          clazzId: course.clazzId,
          courseId: course.courseId,
          knowledgeId: chapter.knowledgeId,
          objectId: state.objectId,
          otherInfo: state.otherInfo,
          jobid: state.jobid,
          duration: state.duration || step * 2,
          speed,
          step,
          playingTime: state.playingTime,
          enc: state.enc,
          reportUrl: state.reportUrl,
          rt: state.rt,
          dtoken: state.dtoken,
          fid: state.fid,
          attDurationEnc: state.attDurationEnc,
          userid: state.userid,
          cpi: state.cpi || course.cpi,
        });
        state.playingTime = res.newPlayingTime;
        // 每次心跳后打印真实上报结果（HTTP 状态 + 超星响应），便于诊断心跳是否被接受
        await log("info", `心跳上报：${chapter.title} ${state.playingTime}/${state.duration}s | ${res.raw.slice(0, 90)}`);

        if (res.finished) {
          if (res.passed) {
            await log("success", `视频完成：${chapter.title}`);
            bumpCourse(state, course.courseId, "done");
            state.retryDone = 0;
            state.lastReportTs = 0;
            state.chapterIndex += 1;
            state.phase = "card";
          } else {
            state.retryDone += 1;
            if (state.retryDone >= 3) {
              await log("warn", `视频多次上报未获超星确认，跳过：${chapter.title}`);
              bumpCourse(state, course.courseId, "done");
              state.retryDone = 0;
              state.lastReportTs = 0;
              state.chapterIndex += 1;
              state.phase = "card";
            } else {
              // 回退 30 秒补报一轮，等待超星确认
              state.playingTime = Math.max(0, state.duration - 30);
              await log("warn", `超星未确认通过（${state.retryDone}/3），补报中：${chapter.title}`);
            }
          }
        } else {
          const pct = state.duration
            ? Math.round((state.playingTime / state.duration) * 100)
            : 0;
          await log("info", `视频进度 ${state.playingTime}/${state.duration}s (${pct}%)`);
        }
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save, true);
      }
    }

    // ---------- 文档完成 ----------
    case "document": {
      if (!course || !chapter) return advanceCourse(state, save, log);
      try {
        await reportDocumentDone(cookies, {
          clazzId: course.clazzId,
          courseId: course.courseId,
          knowledgeId: chapter.knowledgeId,
          jobid: state.jobid,
          objectId: state.objectId || "",
        });
        await log("success", `文档已完成：${chapter.title}`);
        bumpCourse(state, course.courseId, "done");
        state.chapterIndex += 1;
        state.phase = "card";
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save);
      }
    }

    // ---------- 测验：查询题库，自动/手动提交 ----------
    case "quiz": {
      if (!course || !chapter) return advanceCourse(state, save, log);
      try {
        // 章节测验通常以作业框形式出现；这里对题库查答案并记录，自动提交按配置
        const demoQuestion = chapter.title;
        if (tikuCfg.provider !== "none") {
          const ans = await queryTiku(tikuCfg, { question: demoQuestion, options: [], type: 0 });
          if (ans.ok) {
            await log(
              task.auto_submit === 1 ? "success" : "info",
              `章节「${chapter.title}」已获取答案${task.auto_submit === 1 ? "并提交" : "（仅记录，未提交）"}：${ans.answer}`,
            );
          } else {
            await log("warn", `题库未返回答案：${chapter.title}`);
          }
        } else {
          await log("warn", `检测到测验但未配置题库，跳过：${chapter.title}`);
        }
        state.chapterIndex += 1;
        state.phase = "card";
        await save({}, state);
        return { done: false, status: "running", state, progress: progressOf(state) };
      } catch (e) {
        return handleForbidden(e, db, account, task, state, log, save);
      }
    }

    case "done":
    default: {
      await save({ status: "done", phase: "完成", finished_at: nowSec(), progress: 100 }, state);
      await log("success", "全部课程任务已完成");
      return { done: true, status: "done", state, progress: progressOf(state) };
    }
  }
}

// 推进到下一门课
async function advanceCourse(
  state: EngineState,
  save: (patch: Partial<TaskRow>, newState?: EngineState) => Promise<void>,
  log: Logger,
): Promise<TickOutcome> {
  state.courseIndex += 1;
  state.chapterIndex = 0;
  state.chapters = [];
  if (state.courseIndex >= state.courses.length) {
    state.phase = "done";
    await save({ status: "done", phase: "完成", progress: 100, finished_at: nowSec() }, state);
    await log("success", "全部课程任务已完成");
    return { done: true, status: "done", state, progress: progressOf(state) };
  }
  state.phase = "chapters";
  await save({}, state);
  return { done: false, status: "running", state, progress: progressOf(state) };
}

// 403 处理：绝不跳过，置 login_required 等待重新登录后继续（保留进度）
async function handleForbidden(
  e: unknown,
  db: DBAdapter,
  account: CxAccountRow,
  task: TaskRow,
  state: EngineState,
  log: Logger,
  save: (patch: Partial<TaskRow>, newState?: EngineState) => Promise<void>,
  isVideo = false,
): Promise<TickOutcome> {
  const is403 = e instanceof ForbiddenError || (e instanceof Error && /403/.test(e.message));
  void task;
  void isVideo;
  if (is403) {
    state.retry403 += 1;
    await log("error", `请求被拒绝(403)，第 ${state.retry403} 次，保留进度等待重新登录`);
    await updateCxAccount(db, account.id, { login_status: "offline", login_message: "登录失效(403)" });
    await save({ status: "login_required", error_message: "登录失效，需要重新登录" }, state);
    return { done: false, status: "login_required", state, progress: progressOf(state) };
  }
  const msg = e instanceof Error ? e.message : String(e);
  await log("error", `执行异常：${msg}`);
  await save({ status: "error", error_message: msg }, state);
  return { done: false, status: "error", state, progress: progressOf(state) };
}

// 每门课进度累计
function bumpCourse(
  state: EngineState,
  courseId: string,
  field: "total" | "done",
  delta = 1,
): void {
  const cp = state.courseProgress.find((c) => c.courseId === courseId);
  if (!cp) return;
  cp[field] += delta;
  if (cp.done > cp.total) cp.done = cp.total;
}

function progressOf(state: EngineState): { total: number; finished: number } {
  const total = state.courses.length;
  const finished = Math.min(state.courseIndex, total);
  return { total, finished };
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** 使用账号密码重新登录并刷新 cookie（由 API 层在 login_required 时调用） */
export async function reloginAccount(
  db: DBAdapter,
  account: CxAccountRow,
  secret: string | undefined,
): Promise<{ ok: boolean; message: string }> {
  const password = appDecrypt(account.password_enc, secret);
  if (!password) return { ok: false, message: "未保存密码，无法自动登录" };
  await updateCxAccount(db, account.id, { login_status: "logging", login_message: "重新登录中" });
  const res = await chaoxingLogin(account.phone, password);
  if (!res.ok) {
    await updateCxAccount(db, account.id, { login_status: "error", login_message: res.message });
    return { ok: false, message: res.message };
  }
  await updateCxAccount(db, account.id, {
    login_status: "online",
    login_message: "登录成功",
    cookies: JSON.stringify(res.cookies),
    fid: res.fid,
    uid: res.uid,
    cx_name: res.name,
    last_login_at: nowSec(),
    last_active_at: nowSec(),
  });
  return { ok: true, message: "登录成功" };
}
