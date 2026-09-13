import { sha256Hex } from "./auth-password";

// 无状态会话：token 内容为 "userId.expires.signature"，存于 httpOnly cookie
const COOKIE_NAME = "cx_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 天

export interface SessionPayload {
  userId: number;
  role: string;
  expires: number;
}

function secret(envSecret?: string): string {
  return envSecret && envSecret.length > 8 ? envSecret : "dev-session-secret-change-me";
}

async function sign(body: string, envSecret?: string): Promise<string> {
  return sha256Hex(`${body}.${secret(envSecret)}`);
}

export async function createSessionToken(
  payload: { userId: number; role: string },
  envSecret?: string,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const body = `${payload.userId}.${payload.role}.${expires}`;
  const sig = await sign(body, envSecret);
  return `${body}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined,
  envSecret?: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userIdRaw, role, expiresRaw, sig] = parts;
  const body = `${userIdRaw}.${role}.${expiresRaw}`;
  const expected = await sign(body, envSecret);
  if (sig !== expected) return null;
  const expires = Number(expiresRaw);
  if (!expires || expires < Math.floor(Date.now() / 1000)) return null;
  return { userId: Number(userIdRaw), role, expires };
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = MAX_AGE_SEC;

export function buildSetCookie(token: string, maxAge = MAX_AGE_SEC): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function buildClearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}
