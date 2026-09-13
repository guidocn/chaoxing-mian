// 超星 HTTP 客户端：在 Cloudflare Workers fetch 之上维护 cookie jar

export type CookieJar = Record<string, string>;

export function parseSetCookie(setCookie: string[] | null, jar: CookieJar): void {
  if (!setCookie) return;
  for (const line of setCookie) {
    const first = line.split(";")[0];
    const idx = first.indexOf("=");
    if (idx > 0) {
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (name) jar[name] = value;
    }
  }
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  form?: Record<string, string | number | boolean>;
  json?: unknown;
  // 毫秒
  timeout?: number;
  redirect?: RequestRedirect;
}

export class CxClient {
  jar: CookieJar;

  constructor(cookies: CookieJar = {}) {
    this.jar = { ...cookies };
  }

  getCookie(name: string): string {
    return this.jar[name] ?? "";
  }

  setCookie(name: string, value: string, domain = ".chaoxing.com"): void {
    void domain;
    this.jar[name] = value;
  }

  private async raw(url: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(opts.headers ?? {}),
    };
    const cookie = cookieHeader(this.jar);
    if (cookie) headers["Cookie"] = cookie;

    let body: BodyInit | undefined;
    if (opts.form) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/x-www-form-urlencoded; charset=UTF-8";
      body = new URLSearchParams(
        Object.entries(opts.form).map(([k, v]) => [k, String(v)]),
      ).toString();
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    const controller = new AbortController();
    const timeout = opts.timeout ?? 30000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body,
        redirect: opts.redirect ?? "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // 跟随重定向并记录 cookie
  async request(url: string, opts: RequestOptions = {}): Promise<{ status: number; text: string; headers: Headers; finalUrl: string }> {
    let current = url;
    let response = await this.raw(current, opts);
    let hops = 0;
    while (response.status >= 300 && response.status < 400 && hops < 5) {
      parseSetCookie(response.headers.getSetCookie?.() ?? [], this.jar);
      const loc = response.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      // 重定向后的 GET 不带 body
      response = await this.raw(current, { ...opts, method: "GET", form: undefined, json: undefined });
      hops += 1;
    }
    parseSetCookie(response.headers.getSetCookie?.() ?? [], this.jar);
    const text = await response.text();
    return { status: response.status, text, headers: response.headers, finalUrl: current };
  }

  async get(url: string, opts: RequestOptions = {}): Promise<{ status: number; text: string; headers: Headers; finalUrl: string }> {
    return this.request(url, { ...opts, method: "GET" });
  }

  async post(url: string, opts: RequestOptions = {}): Promise<{ status: number; text: string; headers: Headers; finalUrl: string }> {
    return this.request(url, { ...opts, method: "POST" });
  }

  // 不跟随重定向（视频上报等接口需要直接读取返回）
  async postNoRedirect(url: string, opts: RequestOptions = {}): Promise<{ status: number; text: string }> {
    const r = await this.raw(url, { ...opts, method: "POST", redirect: "manual" });
    parseSetCookie(r.headers.getSetCookie?.() ?? [], this.jar);
    return { status: r.status, text: await r.text() };
  }
}
