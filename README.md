# 超星学习通自动化刷课平台（Cloudflare Pages 版）

多用户、多账号并行的超星学习通自动刷课平台。前端使用 Next.js 16 + React 19 + shadcn/ui，
数据存储使用 Cloudflare D1，可一键部署到 Cloudflare Pages。

## 功能

- 用户注册 / 登录（PBKDF2 密码哈希、httpOnly 签名会话）
- 每个用户添加并管理自己的多个超星账号（手机号 + 密码，AES 加密落库）
- 自动登录超星、拉取课程列表、勾选要刷的课程
- 自动刷视频（倍速、心跳续期、403 自动重登重试）、阅读文档、自动答题
- 多题库支持：不使用题库 / ZError 自建题库 / 本地题库（TikuAdapter 风格）/ 言溪 / LIKE / AI
- 题库连接测试
- 实时任务日志、进度统计、断点续跑
- 管理后台：用户统计、配额、封禁/解封、设为/取消管理员

## 架构说明

Cloudflare Workers/Pages 没有长驻后台进程，因此任务采用"前端驱动的 tick 模型"：
任务页在运行状态下每隔约 3 秒调用一次 `/api/accounts/[id]/task/tick`，
服务端每次推进一小步（登录 → 选课程 → 进入章节 → 刷视频/文档/测验 → 下一章节），
状态持久化在 D1 中，天然断点续跑。多个账号在不同浏览器/标签页中各自驱动 tick，实现并行。

## 本地开发

```bash
pnpm install
pnpm dev          # 无 D1 时使用本地 JSON 存储 (.local-db.json)
```

本地可在项目根目录新建 `.dev.vars` 配置密钥：

```
APP_SECRET="请改成一段足够长的随机字符串"
ADMIN_SETUP_CODE="可选的管理员邀请码"
```

## 部署到 Cloudflare Pages

### 1. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create cx_auto_study
```

把输出的 `database_id` 填入 `wrangler.toml` 的 `database_id`。

### 2. 初始化表结构

生产库：

```bash
npx wrangler d1 execute cx_auto_study --remote --file=./schema.sql
```

### 3. 配置环境变量（Pages → 项目 → Settings → Variables）

- `APP_SECRET`：会话与凭据加密主密钥，至少 32 位随机字符串，务必设置
- `ADMIN_SETUP_CODE`：可选，注册额外管理员时填写的邀请码
- `ENVIRONMENT`：`production`

并在 Pages 项目的 Functions → D1 database bindings 中绑定：
- Variable name：`DB`
- D1 database：`cx_auto_study`

### 4. 构建与部署

```bash
pnpm pages:build      # 产出 .vercel/output/static
pnpm pages:deploy     # 部署到 Cloudflare Pages
```

也可在 Cloudflare 控制台连接 Git 仓库，设置：

- Framework preset：Next.js
- Build command：`npx @cloudflare/next-on-pages`
- Build output directory：`.vercel/output/static`
- Compatibility flags：`nodejs_compat`

### 5. 首位管理员

第一个成功注册的用户自动成为管理员；之后可在管理后台管理其他用户，
或用 `ADMIN_SETUP_CODE` 邀请码继续注册管理员。

## 目录结构

```
schema.sql                       D1 表结构
wrangler.toml                    Cloudflare D1 绑定配置
src/lib/
  chaoxing/                      超星接口：登录、课程、视频、章节解码、题库
  engine/tick.ts                 单步任务引擎（登录/课程/章节/视频/文档/答题）
  db/                            存储层：D1 适配器 + 本地 JSON 适配器 + repo
  auth-password.ts / session.ts  密码哈希与会话签名
  server.ts                      运行时上下文、登录态/管理员校验
src/app/
  login/                         登录注册页
  dashboard/                     用户控制台
  admin/                         管理后台
  api/                           所有后端接口
```

## 合规说明

本项目仅用于个人学习与自动化技术研究，请遵守所在学校相关规定与超星平台用户协议，
由此产生的账号风险与后果由使用者自行承担。
