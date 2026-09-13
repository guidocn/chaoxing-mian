// 平台领域类型定义

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "banned";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  quota: number;
  created_at: number;
  last_login_at: number | null;
}

export type LoginStatus =
  | "idle"
  | "logging"
  | "online"
  | "offline"
  | "error";

export interface CxAccountRow {
  id: number;
  user_id: number;
  label: string;
  phone: string;
  password_enc: string;
  cookies: string;
  login_status: LoginStatus;
  login_message: string;
  fid: string;
  uid: string;
  cx_name: string;
  last_login_at: number | null;
  last_active_at: number | null;
  created_at: number;
}

export type TaskStatus =
  | "idle"
  | "running"
  | "paused"
  | "done"
  | "error"
  | "login_required";

export interface TaskRow {
  id: number;
  account_id: number;
  user_id: number;
  speed: number;
  auto_submit: number;
  tiku_provider: string;
  tiku_api: string;
  tiku_token: string;
  skip_locked: number;
  status: TaskStatus;
  phase: string;
  current_course: string;
  current_chapter: string;
  progress: number;
  total_points: number;
  done_points: number;
  error_message: string;
  state: string;
  stats: string;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
  created_at: number;
}

export interface LogRow {
  id: number;
  task_id: number;
  account_id: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
  created_at: number;
}

export interface CourseRow {
  id: number;
  account_id: number;
  course_id: string;
  clazz_id: string;
  cpi: string;
  title: string;
  teacher: string;
  selected: number;
  updated_at: number;
}

// ===== 前端 DTO（camelCase） =====

export interface MeResponse {
  authenticated: boolean;
  user: {
    id: number;
    email: string;
    nickname: string;
    role: UserRole;
  };
}

export interface CxAccountDTO {
  id: number;
  name: string;
  phone: string;
  active: boolean;
  loginStatus: LoginStatus;
  loginMessage: string;
  cxName: string;
  fid: string;
  uid: string;
  cookiesValid: boolean;
  lastLoginAt: number | null;
  // 来自任务的汇总
  status: TaskStatus;
  speed: number;
  autoSubmit: boolean;
  totalCourses: number;
  completedCourses: number;
  lastError: string;
}

export interface TaskDTO {
  id: number;
  accountId: number;
  status: TaskStatus;
  phase: string;
  currentCourse: string;
  currentChapter: string;
  progress: number;
  totalPoints: number;
  donePoints: number;
  failedPoints: number;
  skippedPoints: number;
  speed: number;
  autoSubmit: boolean;
  tikuProvider: string;
  tikuApi: string;
  tikuToken: string;
  errorMessage: string;
  startedAt: number | null;
  updatedAt: number;
}

export interface CourseDTO {
  id: number;
  courseId: string;
  clazzId: string;
  cpi: string;
  title: string;
  teacher: string;
  selected: boolean;
  progress: number;
}

export interface LogDTO {
  id: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface AdminUserDTO {
  id: number;
  email: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  accountCount: number;
  runningCount: number;
  createdAt: string;
}
