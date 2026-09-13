// Cloudflare 运行时环境绑定类型
// D1 数据库绑定在 wrangler.toml / Pages 中配置为 DB

export interface Env {
  DB?: D1Database;
  // 用于加密超星密码 / 签名会话的密钥（在 Pages 环境变量中配置）
  APP_SECRET?: string;
  // 管理员初始注册码（配置后，首个用此邀请码注册的账号成为管理员）
  ADMIN_SETUP_CODE?: string;
  // 运行环境标识
  ENVIRONMENT?: string;
}

// 统一的一行数据类型
export type Row = Record<string, unknown>;

// 抽象数据库接口，云端 D1 与本地内存实现共用
export interface DBAdapter {
  all<T = Row>(query: string, ...params: unknown[]): Promise<T[]>;
  get<T = Row>(query: string, ...params: unknown[]): Promise<T | null>;
  run(query: string, ...params: unknown[]): Promise<{ lastRowId: number }>;
  exec(sql: string): Promise<void>;
}
