# AGENTS.md

## 项目概览

超星学习通自动化刷课平台的 **Cloudflare Pages 版本**。多用户、多账号并行，用户注册登录后自行添加超星账号刷课，含管理后台。

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19 + TypeScript 5（strict）
- **UI**: shadcn/ui（Radix UI）+ Tailwind CSS 4
- **数据库**: Cloudflare D1（生产）/ JSON 文件 `.local-db.json`（本地 dev 兜底）
- **部署**: Cloudflare Pages，使用 `@cloudflare/next-on-pages` 构建，`nodejs_compat`
- 旧 Python 实现归档在 `legacy_python/`，仅作参考，不参与构建。

## 核心架构：tick 任务模型

Cloudflare 无长驻进程。任务页在 running 时每约 3 秒调用 `POST /api/accounts/[id]/task/tick`，服务端每请求推进一小步并把状态写回 D1，实现断点续跑。多账号在不同会话各自 tick 即并行。

## 常用命令

- 开发：`pnpm dev`
- 类型检查：`pnpm ts-check`
- Lint：`pnpm lint --quiet`
- 生产构建：`pnpm build`
- Cloudflare 构建：`pnpm pages:build`
- D1 初始化：`npx wrangler d1 execute cx_auto_study --remote --file=./schema.sql`

仅允许使用 **pnpm**。

## 关键目录

- `schema.sql`：D1 表结构（users / cx_accounts / courses / tasks / task_logs / settings）
- `src/lib/chaoxing/`：超星登录、课程、视频、章节解码、题库
- `src/lib/engine/tick.ts`：单步任务引擎
- `src/lib/db/`：`d1-adapter.ts`、`local-adapter.ts`、`repo.ts`（数据访问统一走 repo）
- `src/lib/server.ts`：`getRuntime()`（取 D1 绑定与密钥）、`requireUser()`、`requireAdmin()`
- `src/app/api/`：全部后端路由；`src/app/dashboard` 用户端；`src/app/admin` 管理端

## 编码规范

- strict TS，禁止隐式 any / `as any`；事件对象、函数参数需明确类型。
- 所有 API 路由 `export const runtime = "nodejs"`（刷课依赖 Node crypto 与 fetch 保持一致）。
- 密钥只从 `getRuntime()` 的 `secret` 获取（Cloudflare env 或 `process.env.APP_SECRET`），禁止硬编码。
- 超星账号密码用 `appEncrypt/appDecrypt`（AES）加密后存 `password_enc`，禁止明文。
- 数据序列化统一经 `src/lib/serialize.ts`（snake_case 行 → 前端 DTO camelCase）。
- Hydration：动态内容必须在客户端 `useEffect` 后渲染；非法 HTML 嵌套禁止。

## 403 处理策略

视频/章节请求遇 403 不在引擎内跳过任务，而是置 `login_required`；tick 路由检测到后用库中加密密码自动重登并把任务改回 running 续跑，形成重试闭环。

## 测试

- 交付前必须 `pnpm ts-check` + `pnpm lint --quiet` + `pnpm build`。
- API 冒烟通过 `test_run`；注意每条命令是独立 shell，cookie/header 文件不跨命令保留，需在单条命令内完成登录与后续请求。
