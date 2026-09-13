-- 超星云刷课平台 D1 数据库结构
-- 适用于 Cloudflare D1 (SQLite)

-- 平台用户（登录本站的账号）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',           -- user | admin
  status TEXT NOT NULL DEFAULT 'active',       -- active | banned
  quota INTEGER NOT NULL DEFAULT 3,            -- 可绑定的超星账号上限
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 超星学习通账号（每个用户可绑定多个）
CREATE TABLE IF NOT EXISTS cx_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',              -- 用户给账号起的备注名
  phone TEXT NOT NULL,                         -- 超星手机号/学号
  password_enc TEXT NOT NULL DEFAULT '',       -- 超星密码（AES 加密，兼容在线登录）
  cookies TEXT NOT NULL DEFAULT '{}',          -- 登录后的 cookie JSON
  login_status TEXT NOT NULL DEFAULT 'idle',   -- idle | logging | online | offline | error
  login_message TEXT NOT NULL DEFAULT '',
  fid TEXT NOT NULL DEFAULT '',
  uid TEXT NOT NULL DEFAULT '',
  cx_name TEXT NOT NULL DEFAULT '',            -- 超星昵称/学校
  last_login_at INTEGER,
  last_active_at INTEGER,
  created_at INTEGER NOT NULL
);

-- 刷课任务（一个超星账号可同时只有一个运行中的任务）
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES cx_accounts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speed REAL NOT NULL DEFAULT 2.0,             -- 视频倍速
  auto_submit INTEGER NOT NULL DEFAULT 1,      -- 测验是否自动提交
  tiku_provider TEXT NOT NULL DEFAULT 'none',  -- none | zerror | local | yanxi | like | ai
  tiku_api TEXT NOT NULL DEFAULT '',
  tiku_token TEXT NOT NULL DEFAULT '',
  skip_locked INTEGER NOT NULL DEFAULT 1,      -- 跳过未开放章节
  status TEXT NOT NULL DEFAULT 'idle',         -- idle | running | paused | done | error | login_required
  phase TEXT NOT NULL DEFAULT '',              -- 当前阶段：login/courses/chapters/video/doc/work/quiz
  current_course TEXT NOT NULL DEFAULT '',
  current_chapter TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,         -- 整体进度 0-100
  total_points INTEGER NOT NULL DEFAULT 0,
  done_points INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '{}',            -- 引擎断点续跑状态 JSON
  stats TEXT NOT NULL DEFAULT '{}',            -- 统计 JSON
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 任务执行日志（滚动写入，控制台实时展示）
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',          -- info | success | warn | error
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 课程快照（拉取后保存，供前端勾选）
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES cx_accounts(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  clazz_id TEXT NOT NULL,
  cpi TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  teacher TEXT NOT NULL DEFAULT '',
  selected INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, course_id, clazz_id)
);

-- 平台全局设置（管理员配置）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cx_accounts_user ON cx_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_logs_task ON task_logs(task_id, id);
CREATE INDEX IF NOT EXISTS idx_courses_account ON courses(account_id);
