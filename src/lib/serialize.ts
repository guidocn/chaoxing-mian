import type {
  CourseRow,
  CxAccountRow,
  LogRow,
  TaskRow,
  UserRow,
  CxAccountDTO,
  TaskDTO,
  CourseDTO,
  LogDTO,
  AdminUserDTO,
} from "@/lib/types";

// stats JSON 结构（引擎写入）
interface TaskStats {
  failed?: number;
  skipped?: number;
  [k: string]: unknown;
}

function fmtTime(sec: number | null): string {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

export function serializeTask(t: TaskRow | null): TaskDTO | null {
  if (!t) return null;
  const stats = safeParse<TaskStats>(t.stats, {});
  return {
    id: t.id,
    accountId: t.account_id,
    status: t.status,
    phase: t.phase,
    currentCourse: t.current_course,
    currentChapter: t.current_chapter,
    progress: t.progress,
    totalPoints: t.total_points,
    donePoints: t.done_points,
    failedPoints: stats.failed ?? 0,
    skippedPoints: stats.skipped ?? 0,
    speed: t.speed,
    autoSubmit: t.auto_submit === 1,
    tikuProvider: t.tiku_provider,
    tikuApi: t.tiku_api,
    tikuToken: t.tiku_token,
    errorMessage: t.error_message,
    startedAt: t.started_at,
    updatedAt: t.updated_at,
  };
}

export function serializeAccount(
  a: CxAccountRow,
  task: TaskRow | null,
  courseCount: number,
  selectedCount: number,
): CxAccountDTO {
  return {
    id: a.id,
    name: a.label,
    phone: a.phone,
    active: a.login_status !== "offline",
    loginStatus: a.login_status,
    loginMessage: a.login_message,
    cxName: a.cx_name,
    fid: a.fid,
    uid: a.uid,
    cookiesValid: a.login_status === "online" && !!a.cookies && a.cookies !== "{}",
    lastLoginAt: a.last_login_at,
    status: task ? task.status : "idle",
    speed: task ? task.speed : 2,
    autoSubmit: task ? task.auto_submit === 1 : true,
    totalCourses: courseCount,
    completedCourses: selectedCount,
    lastError: task?.error_message ?? "",
  };
}

export function serializeCourse(c: CourseRow): CourseDTO {
  return {
    id: c.id,
    courseId: c.course_id,
    clazzId: c.clazz_id,
    cpi: c.cpi,
    title: c.title,
    teacher: c.teacher,
    selected: c.selected === 1,
    progress: 0,
  };
}

export function serializeLog(l: LogRow): LogDTO {
  return {
    id: l.id,
    level: l.level,
    message: l.message,
    createdAt: fmtTime(l.created_at),
  };
}

export function serializeAdminUser(
  u: UserRow,
  accountCount: number,
  runningCount: number,
): AdminUserDTO {
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    role: u.role,
    status: u.status,
    accountCount,
    runningCount,
    createdAt: fmtTime(u.created_at),
  };
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
