import type { DBAdapter } from "@/types/env";
import { nowSec } from "./index";
import type {
  CourseRow,
  CxAccountRow,
  LogRow,
  TaskRow,
  UserRow,
} from "../types";

// 集中的数据访问函数（SQL 面向 D1 / SQLite）

export async function findUserByEmail(db: DBAdapter, email: string): Promise<UserRow | null> {
  return db.get<UserRow>("SELECT * FROM users WHERE email = ?", email.toLowerCase());
}

export async function getUserById(db: DBAdapter, id: number): Promise<UserRow | null> {
  return db.get<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export async function countUsers(db: DBAdapter): Promise<number> {
  const r = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  return r?.c ?? 0;
}

export async function createUser(
  db: DBAdapter,
  p: { email: string; passwordHash: string; nickname: string; role: string; quota: number },
): Promise<number> {
  const r = await db.run(
    "INSERT INTO users (email,password_hash,nickname,role,status,quota,created_at) VALUES (?,?,?,?,?,?,?)",
    p.email.toLowerCase(),
    p.passwordHash,
    p.nickname,
    p.role,
    "active",
    p.quota,
    nowSec(),
  );
  return r.lastRowId;
}

export async function listUsers(db: DBAdapter): Promise<UserRow[]> {
  return db.all<UserRow>("SELECT * FROM users ORDER BY id ASC");
}

export async function updateUserLastLogin(db: DBAdapter, id: number): Promise<void> {
  await db.run("UPDATE users SET last_login_at = ? WHERE id = ?", nowSec(), id);
}

export async function setUserStatus(db: DBAdapter, id: number, status: string): Promise<void> {
  await db.run("UPDATE users SET status = ? WHERE id = ?", status, id);
}

export async function setUserQuota(db: DBAdapter, id: number, quota: number): Promise<void> {
  await db.run("UPDATE users SET quota = ? WHERE id = ?", quota, id);
}

export async function countCxAccounts(db: DBAdapter, userId: number): Promise<number> {
  const r = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM cx_accounts WHERE user_id = ?",
    userId,
  );
  return r?.c ?? 0;
}

export async function listCxAccounts(db: DBAdapter, userId: number): Promise<CxAccountRow[]> {
  return db.all<CxAccountRow>(
    "SELECT * FROM cx_accounts WHERE user_id = ? ORDER BY id ASC",
    userId,
  );
}

export async function listAllCxAccounts(db: DBAdapter): Promise<CxAccountRow[]> {
  return db.all<CxAccountRow>("SELECT * FROM cx_accounts ORDER BY id ASC");
}

export async function getCxAccount(db: DBAdapter, id: number): Promise<CxAccountRow | null> {
  return db.get<CxAccountRow>("SELECT * FROM cx_accounts WHERE id = ?", id);
}

export async function createCxAccount(
  db: DBAdapter,
  p: { userId: number; label: string; phone: string; passwordEnc: string },
): Promise<number> {
  const r = await db.run(
    "INSERT INTO cx_accounts (user_id,label,phone,password_enc,cookies,login_status,created_at) VALUES (?,?,?,?,?,?,?)",
    p.userId,
    p.label,
    p.phone,
    p.passwordEnc,
    "{}",
    "idle",
    nowSec(),
  );
  return r.lastRowId;
}

export async function updateCxAccount(
  db: DBAdapter,
  id: number,
  fields: Partial<Pick<CxAccountRow, "label" | "phone" | "password_enc" | "cookies" | "login_status" | "login_message" | "fid" | "uid" | "cx_name" | "last_login_at" | "last_active_at">>,
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k as keyof typeof fields] as unknown);
  await db.run(`UPDATE cx_accounts SET ${setSql} WHERE id = ?`, ...vals, id);
}

export async function deleteCxAccount(db: DBAdapter, id: number): Promise<void> {
  await db.run("DELETE FROM task_logs WHERE account_id = ?", id);
  await db.run("DELETE FROM courses WHERE account_id = ?", id);
  await db.run("DELETE FROM tasks WHERE account_id = ?", id);
  await db.run("DELETE FROM cx_accounts WHERE id = ?", id);
}

export async function getTaskByAccount(db: DBAdapter, accountId: number): Promise<TaskRow | null> {
  return db.get<TaskRow>("SELECT * FROM tasks WHERE account_id = ? ORDER BY id DESC LIMIT 1", accountId);
}

export async function getTaskById(db: DBAdapter, id: number): Promise<TaskRow | null> {
  return db.get<TaskRow>("SELECT * FROM tasks WHERE id = ?", id);
}

export async function updateTaskRow(
  db: DBAdapter,
  id: number,
  fields: Partial<
    Pick<
      TaskRow,
      | "status"
      | "phase"
      | "current_course"
      | "current_chapter"
      | "progress"
      | "total_points"
      | "done_points"
      | "error_message"
      | "state"
      | "stats"
      | "speed"
      | "auto_submit"
      | "tiku_provider"
      | "tiku_api"
      | "tiku_token"
      | "skip_locked"
      | "started_at"
      | "finished_at"
      | "updated_at"
    >
  >,
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k as keyof typeof fields] as unknown);
  await db.run(`UPDATE tasks SET ${setSql} WHERE id = ?`, ...vals, id);
}

export async function listTasksByUser(db: DBAdapter, userId: number): Promise<TaskRow[]> {
  return db.all<TaskRow>("SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC", userId);
}

export async function listAllTasks(db: DBAdapter): Promise<TaskRow[]> {
  return db.all<TaskRow>("SELECT * FROM tasks ORDER BY id DESC");
}

export async function deleteTask(db: DBAdapter, id: number): Promise<void> {
  await db.run("DELETE FROM task_logs WHERE task_id = ?", id);
  await db.run("DELETE FROM tasks WHERE id = ?", id);
}

export async function createTask(
  db: DBAdapter,
  p: {
    accountId: number;
    userId: number;
    speed: number;
    autoSubmit: number;
    tikuProvider: string;
    tikuApi: string;
    tikuToken: string;
    skipLocked: number;
  },
): Promise<number> {
  const ts = nowSec();
  const r = await db.run(
    `INSERT INTO tasks
      (account_id,user_id,speed,auto_submit,tiku_provider,tiku_api,tiku_token,skip_locked,
       status,state,stats,updated_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    p.accountId,
    p.userId,
    p.speed,
    p.autoSubmit,
    p.tikuProvider,
    p.tikuApi,
    p.tikuToken,
    p.skipLocked,
    "idle",
    "{}",
    "{}",
    ts,
    ts,
  );
  return r.lastRowId;
}

export async function listRunningTasks(db: DBAdapter): Promise<TaskRow[]> {
  return db.all<TaskRow>("SELECT * FROM tasks WHERE status IN (?, ?) ORDER BY id ASC", "running", "paused");
}

export async function listRecentLogs(db: DBAdapter, taskId: number, afterId = 0, limit = 200): Promise<LogRow[]> {
  return db.all<LogRow>(
    "SELECT * FROM task_logs WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?",
    taskId,
    afterId,
    limit,
  );
}

export async function addLog(
  db: DBAdapter,
  p: { taskId: number; accountId: number; level: string; message: string },
): Promise<void> {
  await db.run(
    "INSERT INTO task_logs (task_id,account_id,level,message,created_at) VALUES (?,?,?,?,?)",
    p.taskId,
    p.accountId,
    p.level,
    p.message,
    nowSec(),
  );
}

export async function pruneLogs(db: DBAdapter, taskId: number, keep = 500): Promise<void> {
  // 仅保留最近 keep 条（D1/SQLite 通用）
  await db.run(
    `DELETE FROM task_logs WHERE task_id = ? AND id NOT IN
      (SELECT id FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?)`,
    taskId,
    taskId,
    keep,
  );
}

export async function upsertCourse(
  db: DBAdapter,
  p: { accountId: number; courseId: string; clazzId: string; cpi: string; title: string; teacher: string },
): Promise<void> {
  const exist = await db.get<{ id: number }>(
    "SELECT id FROM courses WHERE account_id = ? AND course_id = ? AND clazz_id = ?",
    p.accountId,
    p.courseId,
    p.clazzId,
  );
  if (exist) {
    await db.run(
      "UPDATE courses SET cpi=?,title=?,teacher=?,updated_at=? WHERE id=?",
      p.cpi,
      p.title,
      p.teacher,
      nowSec(),
      exist.id,
    );
  } else {
    await db.run(
      "INSERT INTO courses (account_id,course_id,clazz_id,cpi,title,teacher,selected,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      p.accountId,
      p.courseId,
      p.clazzId,
      p.cpi,
      p.title,
      p.teacher,
      0,
      nowSec(),
    );
  }
}

export async function listCourses(db: DBAdapter, accountId: number): Promise<CourseRow[]> {
  return db.all<CourseRow>("SELECT * FROM courses WHERE account_id = ? ORDER BY id ASC", accountId);
}

export async function setCourseSelected(db: DBAdapter, id: number, userId: number, selected: number): Promise<void> {
  await db.run(
    "UPDATE courses SET selected = ? WHERE id = ? AND account_id IN (SELECT id FROM cx_accounts WHERE user_id = ?)",
    selected,
    id,
    userId,
  );
}

export async function getSetting(db: DBAdapter, key: string): Promise<string | null> {
  const r = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return r?.value ?? null;
}

export async function setSetting(db: DBAdapter, key: string, value: string): Promise<void> {
  const exist = await db.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", key);
  if (exist) {
    await db.run("UPDATE settings SET value = ? WHERE key = ?", value, key);
  } else {
    await db.run("INSERT INTO settings (key,value) VALUES (?,?)", key, value);
  }
}

export async function countCoursesByAccount(
  db: DBAdapter,
  accountId: number,
  selected?: number,
): Promise<number> {
  if (selected === undefined) {
    const r = await db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM courses WHERE account_id = ?",
      accountId,
    );
    return r?.c ?? 0;
  }
  const r = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM courses WHERE account_id = ? AND selected = ?",
    accountId,
    selected,
  );
  return r?.c ?? 0;
}

export async function countAccountsByUser(db: DBAdapter, userId: number): Promise<number> {
  const r = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM cx_accounts WHERE user_id = ?",
    userId,
  );
  return r?.c ?? 0;
}

export async function countRunningByUser(db: DBAdapter, userId: number): Promise<number> {
  const r = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND status IN ('running','paused')",
    userId,
  );
  return r?.c ?? 0;
}

export async function setUserRole(db: DBAdapter, id: number, role: string): Promise<void> {
  await db.run("UPDATE users SET role = ? WHERE id = ?", role, id);
}

export async function deleteUserCascade(db: DBAdapter, id: number): Promise<void> {
  const accounts = await db.all<{ id: number }>(
    "SELECT id FROM cx_accounts WHERE user_id = ?",
    id,
  );
  for (const a of accounts) {
    await deleteCxAccount(db, a.id);
  }
  await db.run("DELETE FROM users WHERE id = ?", id);
}

export async function updateUserFields(
  db: DBAdapter,
  id: number,
  fields: Partial<Pick<UserRow, "nickname" | "password_hash" | "role" | "status" | "quota">>,
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => fields[k as keyof typeof fields] as unknown);
  await db.run(`UPDATE users SET ${setSql} WHERE id = ?`, ...vals, id);
}

