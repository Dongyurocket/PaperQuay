/**
 * 轻量文本语言检测，面向文献处理场景：
 * - 判断一篇文献是否以中文为主体（跳过翻译、中文标题直填、中文元数据兜底）。
 * - 归一化设置里的语言取值（"Chinese" / "Simplified Chinese" / "简体中文" / "zh-CN" → "zh"）。
 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_PATTERN = /[A-Za-z]/g;
// 日文假名：日文论文含大量汉字，仅靠汉字会把日文误判为中文。
const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff]/;

export interface ScriptComposition {
  cjk: number;
  latin: number;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function analyzeScriptComposition(text: string): ScriptComposition {
  return {
    cjk: countMatches(text, CJK_PATTERN),
    latin: countMatches(text, LATIN_PATTERN),
  };
}

export function containsCjk(text: string | null | undefined): boolean {
  return Boolean(text) && /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text as string);
}

/** 含日文假名时视为日文文献，不进入中文专属流程（免翻译、中文标题直填等）。 */
export function containsJapaneseKana(text: string | null | undefined): boolean {
  return Boolean(text) && JAPANESE_KANA_PATTERN.test(text as string);
}

/** 标题级中文判定：含汉字且不含日文假名（避免把日文标题误当中文直填）。 */
export function isChineseText(text: string | null | undefined): boolean {
  return containsCjk(text) && !containsJapaneseKana(text);
}

/**
 * 判断文本是否以中文为主体。阈值说明：
 * - 至少 8 个 CJK 字符，避免把夹杂个别中文术语的英文文献误判为中文；
 * - CJK 字符数不低于拉丁字母数的一半，允许中文论文里出现较多英文术语、公式与参考文献。
 */
export function isChineseDominant(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }

  if (containsJapaneseKana(text)) {
    return false;
  }

  const { cjk, latin } = analyzeScriptComposition(text);
  return cjk >= 8 && cjk * 2 >= latin;
}

/** 归一化语言取值到 ISO 风格短码（目前只区分中文 / 英文 / 其他）。 */
export function normalizeLanguageCode(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLocaleLowerCase();

  if (!normalized) {
    return '';
  }

  if (
    normalized === 'zh' ||
    normalized.startsWith('zh-') ||
    normalized === 'chinese' ||
    normalized.includes('chinese') ||
    normalized.includes('中文') ||
    normalized.includes('汉语')
  ) {
    return 'zh';
  }

  if (normalized === 'en' || normalized.startsWith('en-') || normalized === 'english') {
    return 'en';
  }

  return normalized;
}

export function isChineseLanguage(value: string | null | undefined): boolean {
  return normalizeLanguageCode(value) === 'zh';
}
