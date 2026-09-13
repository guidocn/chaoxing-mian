// 题库对接：统一查询接口，支持 ZError / 本地题库 / TikuAdapter / 言溪 / LIKE / AI

export type TikuProvider = "none" | "zerror" | "local" | "yanxi" | "like" | "ai";

export interface TikuConfig {
  provider: TikuProvider;
  api: string;
  token: string;
}

export interface TikuQuestion {
  question: string;
  options: string[];
  // 0 单选 1 多选 2 判断 3 填空
  type: number;
}

export interface TikuAnswer {
  ok: boolean;
  answer: string; // 答案文本，如 "A" / "ABC" / "正确"
  raw?: unknown;
}

function normalizeApi(api: string, suffix: string): string {
  const base = api.trim().replace(/\/+$/, "");
  if (!base) return "";
  if (base.endsWith(suffix)) return base;
  // 若已含路径（如 /adapter-service/search）则原样使用
  if (suffix === "/query" && /\/search|\/query|\/answer/i.test(base)) return base;
  return base + suffix;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text, _status: r.status };
    }
  } finally {
    clearTimeout(timer);
  }
}

function extractAnswer(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  // ZError / 本地题库: { code:1, data:{ answer:"A" } } 或 { data: { answers: [...] } }
  const dataField = (d.data ?? d.result ?? d) as Record<string, unknown>;
  const ans = dataField.answer ?? dataField.Answer ?? dataField.result;
  if (typeof ans === "string") return ans.trim();
  if (Array.isArray(ans)) return ans.map((x) => String(x)).join("");
  if (Array.isArray(dataField.answers)) {
    return (dataField.answers as unknown[]).map((x) => String(x)).join("");
  }
  if (typeof dataField.answer === "string") return dataField.answer;
  return "";
}

/** 查询题库 */
export async function queryTiku(cfg: TikuConfig, q: TikuQuestion): Promise<TikuAnswer> {
  if (!cfg.provider || cfg.provider === "none") {
    return { ok: false, answer: "" };
  }

  switch (cfg.provider) {
    case "zerror":
    case "local": {
      const url = normalizeApi(cfg.api, "/query");
      if (!url) return { ok: false, answer: "" };
      const data = await postJson(url, {
        title: q.question,
        question: q.question,
        options: q.options,
        type: q.type,
      });
      const answer = extractAnswer(data);
      return { ok: !!answer, answer, raw: data };
    }
    case "yanxi": {
      // 言溪题库
      const url = `https://www.tiku.yt/question/query?ticket=${encodeURIComponent(cfg.token)}`;
      const data = await postJson(url, {
        question: q.question,
        options: q.options,
        type: q.type,
      });
      const answer = extractAnswer(data);
      return { ok: !!answer, answer, raw: data };
    }
    case "like": {
      // LIKE 知识库
      const url = `https://tiku.likejunxin.cn/api/v1/query?token=${encodeURIComponent(cfg.token)}`;
      const data = await postJson(url, {
        title: q.question,
        options: q.options,
        type: q.type,
      });
      return { ok: !!extractAnswer(data), answer: extractAnswer(data), raw: data };
    }
    case "ai": {
      // 兼容 OpenAI 格式的自建 AI 答题接口
      if (!cfg.api) return { ok: false, answer: "" };
      const prompt = buildAiPrompt(q);
      const data = await postJson(
        cfg.api,
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "你是答题助手，只输出答案字母或判断词，不要解释。" },
            { role: "user", content: prompt },
          ],
          temperature: 0,
        },
        cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      );
      const content =
        ((data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content) ?? "";
      return { ok: !!content, answer: content.trim(), raw: data };
    }
    default:
      return { ok: false, answer: "" };
  }
}

function buildAiPrompt(q: TikuQuestion): string {
  const typeName = ["单选题", "多选题", "判断题", "填空题"][q.type] ?? "题目";
  const opts = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  return `【${typeName}】${q.question}\n${opts}\n请只输出答案。`;
}

export interface TikuTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

/** 测试题库连接（前端"测试连接"按钮） */
export async function testTikuConnection(cfg: TikuConfig): Promise<TikuTestResult> {
  const start = Date.now();
  try {
    if (!cfg.provider || cfg.provider === "none") {
      return { ok: false, message: "未选择题库", latencyMs: 0 };
    }
    const sample: TikuQuestion = {
      question: "中国的首都是哪里？",
      options: ["上海", "北京", "广州", "深圳"],
      type: 0,
    };
    const res = await queryTiku(cfg, sample);
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { ok: true, message: `连接成功，示例答案：${res.answer}`, latencyMs };
    }
    return { ok: false, message: "已连接但未返回有效答案，请检查题库/Token 配置", latencyMs };
  } catch (e) {
    return {
      ok: false,
      message: `连接失败：${e instanceof Error ? e.message : "网络错误"}`,
      latencyMs: Date.now() - start,
    };
  }
}
