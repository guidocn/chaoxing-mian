// 轻量 HTML/JS 解析（用正则提取超星页面中的结构化数据），避免在 Workers 引入 DOM 依赖

export interface CourseInfo {
  id: string;
  clazzId: string;
  courseId: string;
  cpi: string;
  title: string;
  teacher: string;
  desc: string;
}

/** 解析课程列表页 courselistdata 返回的 HTML */
export function decodeCourseList(html: string): CourseInfo[] {
  const courses: CourseInfo[] = [];
  // 每个课程块 <div ... class="course" ...>
  const blockRe = /<div[^>]*class="[^"]*\bcourse\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div|<ul|$)/gi;
  const blocks = html.match(/<div[^>]*class="[^"]*\bcourse\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\bcourse\b|$)/gi) ?? [];
  void blockRe;
  for (const block of blocks) {
    if (/not-open-tip/.test(block)) continue; // 未开放课程跳过
    const id = /\bid="([^"]+)"/.exec(block)?.[1] ?? "";
    const clazzId = /class="clazzId"[^>]*value="([^"]*)"/.exec(block)?.[1]
      ?? /name="clazzId"[^>]*value="([^"]*)"/.exec(block)?.[1] ?? "";
    const courseId = /class="courseId"[^>]*value="([^"]*)"/.exec(block)?.[1]
      ?? /name="courseId"[^>]*value="([^"]*)"/.exec(block)?.[1] ?? "";
    const href = /<a[^>]*href="([^"]*)"/.exec(block)?.[1] ?? "";
    const cpi = /[?&]cpi=([^&"]+)/.exec(href)?.[1] ?? "";
    const title = /class="course-name"[^>]*title="([^"]*)"/.exec(block)?.[1]
      ?? /<span[^>]*class="[^"]*course-name[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1]?.trim() ?? "";
    const teacher = /class="color3"[^>]*title="([^"]*)"/.exec(block)?.[1]
      ?? /<p[^>]*class="[^"]*color3[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1]?.trim() ?? "";
    const desc = /margint10[^>]*title="([^"]*)"/.exec(block)?.[1] ?? "";
    if (courseId || clazzId) {
      courses.push({
        id,
        clazzId,
        courseId,
        cpi,
        title: decodeEntities(title),
        teacher: decodeEntities(teacher),
        desc: decodeEntities(desc),
      });
    }
  }
  return courses;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export interface ChapterPoint {
  id: string;
  title: string;
  knowledgeId: string;
  clazzId: string;
  courseId: string;
  cpi: string;
  label: string;
  locked: boolean;
}

/** 解析章节列表页 mycourse/studentstudy 中的章节 */
export function decodeChapterList(html: string): { hasLocked: boolean; points: ChapterPoint[] } {
  const points: ChapterPoint[] = [];
  let hasLocked = false;

  // 章节节点 <li ...> 内含 onclick 或 data 属性，以及未完成/锁定标记
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const block = m[0];
    const onclick = /onclick="([^"]*)"/.exec(block)?.[1] ?? "";
    // 典型: getTeacherAjax('xxx','yyy') 或 内含 knowledgeid
    const ids = onclick.match(/'([^']+)'/g)?.map((x) => x.replace(/'/g, "")) ?? [];
    const id = ids[0] ?? /data-id="([^"]+)"/.exec(block)?.[1] ?? "";
    const knowledgeId = ids[1] ?? /knowledgeid["'=:\s]+(\d+)/.exec(block)?.[1] ?? "";
    const title =
      /class="[^"]*articlename[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]?.replace(/<[^>]+>/g, "").trim()
      ?? /title="([^"]*)"/.exec(block)?.[1]
      ?? "";
    const locked = /lock|未开放|未解锁|gray-btn|btn-locked/.test(block);
    if (locked) hasLocked = true;
    if (id || knowledgeId) {
      points.push({
        id,
        knowledgeId,
        title: decodeEntities(title),
        clazzId: "",
        courseId: "",
        cpi: "",
        label: "",
        locked,
      });
    }
  }
  return { hasLocked, points };
}

/** 从卡片 HTML 提取 mArg 配置（包含 objectId、报告参数等） */
export function extractMArg(cardHtml: string): Record<string, unknown> | null { {
    const m = /mArg\s*=\s*(\{[\s\S]*?\});/.exec(cardHtml);
    if (!m) return null;
    try {
      // 对象 key 多为无引号，做宽松处理
      const normalized = m[1].replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }
}

/** 提取 attachMent 定义中的其它任务类型（文档/音频等） */
export function extractAttachments(cardHtml: string): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [];
  const re = /(?:attachMent|attachment)\s*=\s*(\{[\s\S]*?\});/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cardHtml)) !== null) {
    const obj: Record<string, string> = {};
    const propRe = /([a-zA-Z_]\w*)\s*:\s*['"]([^'"]*)['"]/g;
    let p: RegExpExecArray | null;
    while ((p = propRe.exec(m[1])) !== null) obj[p[1]] = p[2];
    result.push(obj);
  }
  return result;
}
