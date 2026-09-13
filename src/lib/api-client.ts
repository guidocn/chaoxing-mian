// 前端统一 API 封装

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    credentials: "same-origin",
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  return data as T;
}

function body(method: string, b?: unknown): RequestInit {
  return { method, body: b !== undefined ? JSON.stringify(b) : undefined };
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, b?: unknown) => request<T>(url, body("POST", b)),
  put: <T>(url: string, b?: unknown) => request<T>(url, body("PUT", b)),
  patch: <T>(url: string, b?: unknown) => request<T>(url, body("PATCH", b)),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
