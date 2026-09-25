/** 极简 DOM 辅助（IE11 可用：不用 append/prepend/closest 等新 API）。 */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`页面缺少元素 #${id}`);
  return node as T;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string; attrs?: Record<string, string> } = {},
  children: Array<Node | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.attrs) {
    for (const key of Object.keys(props.attrs)) node.setAttribute(key, props.attrs[key]);
  }
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: HTMLElement, visible: boolean): void {
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, ms);
  };
}

export function errorMessage(error: unknown): string {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  const record = error as { message?: string; debugInfo?: { message?: string } };
  return (record.debugInfo && record.debugInfo.message) || record.message || String(error);
}

export function paperMetaLine(paper: {
  authors?: Array<string | { name?: string | null; familyName?: string | null }> | null;
  year?: string | number | null;
  publication?: string | null;
}): string {
  const authors = Array.isArray(paper.authors) ? paper.authors : [];
  const names = authors
    .slice(0, 3)
    .map((author) => (typeof author === 'string' ? author : author?.name || author?.familyName || ''))
    .filter(Boolean);
  if (authors.length > 3) names.push('等');
  return [names.join(', '), paper.year ? String(paper.year) : '', paper.publication || ''].filter(Boolean).join(' · ');
}
