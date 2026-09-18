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
  // 课程块：class="course ..."（排除 course-list 容器、course-cover 等）
  const blocks =
    html.match(
      /<div[^>]*class="course(?:[ "]|$)[^"]*"[\s\S]*?(?=<div[^>]*class="course(?:[ "]|$)|$)/gi,
    ) ?? [];
  for (const block of blocks) {
    if (/not-open-tip/.test(block)) continue; // 未开放课程跳过
    const id = /\bid="c_([^"]+)"/.exec(block)?.[1] ?? "";
    const clazzId =
      /class="clazzId"[^>]*value="([^"]*)"/.exec(block)?.[1] ??
      /name="clazzId"[^>]*value="([^"]*)"/.exec(block)?.[1] ??
      "";
    const courseId =
      /class="courseId"[^>]*value="([^"]*)"/.exec(block)?.[1] ??
      /name="courseId"[^>]*value="([^"]*)"/.exec(block)?.[1] ??
      "";
    const href = /<a[^>]*href="([^"]*)"/.exec(block)?.[1] ?? "";
    const cpi = /[?&]cpi=([^&"]+)/.exec(href)?.[1] ?? "";
    // course-name 的 class 常带附加类（如 overHidden2），且 title 属性优先于内容
    const title =
      /<span[^>]*class="[^"]*course-name[^"]*"[^>]*title="([^"]*)"/.exec(block)?.[1] ??
      /<span[^>]*class="[^"]*course-name[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1]?.trim() ??
      "";
    const teacher =
      /class="color3"[^>]*title="([^"]*)"/.exec(block)?.[1] ??
      /<span[^>]*class="[^"]*color3[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1]?.trim() ??
      "";
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
  /** 章节任务点是否全部完成（新版 studentcourse 的 icon_yiwanc 标记） */
  done?: boolean;
}

/** 解析章节列表页（mooc2-ans mycourse/studentcourse 返回的 HTML）中的知识点节点 */
export function decodeChapterList(html: string): { hasLocked: boolean; points: ChapterPoint[]; diag?: string } {
  const points: ChapterPoint[] = [];
  let hasLocked = false;
  const diagParts: string[] = [];
  diagParts.push(`len=${html.length}`);

  // 知识点节点：<div class="chapter_item" id="curXXX" onclick="toOld('courseid','knowledgeId','clazzid',0)" ...>
  // 每个知识点是一个 chapter_item 块，内部含 catalog_name 标题与 input[value=knowledgeId]
  const itemRe =
    /<div[^>]*class="[^"]*chapter_item[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*chapter_item[^"]*"|<div[^>]*class="[^"]*chapter_unit[^"]*"|<\/div>\s*<\/div>\s*<!-- 第二级|<!-- 第二级开始|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[0];
    if (!/chapter_item/.test(block)) continue;
    const onclick = /onclick="([^"]*)"/.exec(block)?.[1] ?? "";
    // toOld('courseId','knowledgeId','clazzId',0)
    const ids = onclick.match(/'([^']+)'/g)?.map((x) => x.replace(/'/g, "")) ?? [];
    const knowledgeId = ids[1] ?? /value="(\d+)"/.exec(block)?.[1] ?? "";
    const id = knowledgeId;
    const title =
      /<span[^>]*class="[^"]*catalog_sbar[^"]*"[^>]*>[\s\S]*?<\/span>\s*([\s\S]*?)<\/a>/.exec(block)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      /title="([^"]*)"/.exec(block)?.[1] ??
      "";
    const locked = /lock|未开放|未解锁|gray-btn|btn-locked/.test(block);
    // 新版章节完成标记：catalog_state icon_yiwanc（全部任务点已完成）
    const done = /icon_yiwanc|已完成/.test(block);
    if (locked) hasLocked = true;
    if (knowledgeId) {
      points.push({
        id,
        knowledgeId,
        title: decodeEntities(title),
        clazzId: "",
        courseId: "",
        cpi: "",
        label: "",
        locked,
        done,
      });
    }
  }

  // 兜底：新版页面若 chapter_item 结构变化，直接扫描 knowledgeid= 链接/参数
  if (points.length === 0) {
    diagParts.push("chapter_item=0");
    const knRe = /(?:knowledgeid|knowledgeId|chapterid)=(\d+)/g;
    const seen = new Set<string>();
    let km: RegExpExecArray | null;
    while ((km = knRe.exec(html)) !== null) {
      const kid = km[1];
      if (seen.has(kid)) continue;
      seen.add(kid);
      // 取该知识点附近的标题（前 300 字符内最近的目录名）
      const before = html.slice(Math.max(0, km.index - 500), km.index);
      const titleM =
        /(?:catalog_name|catalog_sbar|title)["'\s:=<>]{1,6}([^<>"']{2,60})/.exec(before) ??
        /<span[^>]*>([^<>]{2,60})<\/span>/.exec(before.slice(-200));
      points.push({
        id: kid,
        knowledgeId: kid,
        title: titleM ? decodeEntities(titleM[1].trim()) : `章节 ${kid}`,
        clazzId: "",
        courseId: "",
        cpi: "",
        label: "",
        locked: false,
        done: false,
      });
    }
    diagParts.push(`knowledgeid_scan=${points.length}`);
  } else {
    diagParts.push(`chapter_item=${points.length}`);
  }
  if (hasLocked) diagParts.push("has_locked");
  return { hasLocked, points, diag: diagParts.join(" ") };
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
