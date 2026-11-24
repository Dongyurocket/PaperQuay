/**
 * 非 React 模块的界面语言选择。
 *
 * Tiptap 扩展、纯数据工具与 Node 测试不能引入 React context；这里只读
 * `<html lang>`（由 applyDocumentLanguage 同步），保证与 useLocaleText 一致。
 * 文档不存在时按中文兜底。
 */
export function pickDocumentLocaleText<T>(zh: T, en: T): T {
  if (typeof document === 'undefined') return zh;
  return document.documentElement.lang === 'en-US' ? en : zh;
}
