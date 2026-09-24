/** 引用格式化共用的小工具（纯函数，无环境依赖）。 */

/** 去掉结尾的英文/中文句点（GB/T 条目统一由格式化器补句点）。 */
export function trimTrailingPeriod(value: string): string {
  return value.replace(/[.。]+$/, '');
}

/** 清洗一个字段：非字符串按空处理，去首尾空白并去掉结尾句点；有限数字按文本使用（年份/卷期等可能来自导入）。 */
export function cleanPart(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return trimTrailingPeriod(String(value));
  return trimTrailingPeriod(typeof value === 'string' ? value.trim() : '');
}

// CJK 统一表意文字（含全角空格、兼容表意文字）判定。
const CJK_PATTERN = /[\u3000-\u9fff\uf900-\ufaff]/;

export function isCjkText(value: string): boolean {
  return CJK_PATTERN.test(value);
}

/** 是否 CJK 姓名（无空格且含中日韩字符）——CJK 姓名整体使用，不拆姓/名。 */
export function isCjkName(value: string): boolean {
  return !/\s/.test(value) && isCjkText(value);
}

/** APA 风格缩写："John Robert" -> "J. R."。 */
export function initialsWithDots(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${token[0].toUpperCase()}.`)
    .join(' ');
}

/** GB/T 西文缩写："John Robert" -> "J R"（无点，GB/T 7714-2015 不写点）。 */
export function initialsCompact(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase())
    .join(' ');
}

/** 过滤空值后拼接（默认 ", "）。 */
export function joinParts(parts: Array<string | null | undefined>, separator = ', '): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}
