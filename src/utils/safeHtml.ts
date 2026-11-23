const ALLOWED_TABLE_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'p',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'sup',
  'sub',
  'br',
]);

const ALLOWED_ATTRIBUTES = new Set(['rowspan', 'colspan', 'scope']);

/**
 * 这些标签连同子树一起丢弃。只做 unwrap 会把 `<script>` 的文本搬进可见内容，
 * 也会让 `<iframe srcdoc>` 等嵌入式内容以子节点形式存活。
 */
const DROP_WITH_SUBTREE = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'template',
  'noscript',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
]);

function sanitizeNode(node: Node): void {
  if (node.nodeType === Node.COMMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (DROP_WITH_SUBTREE.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TABLE_TAGS.has(tagName)) {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    // 先把子节点搬出，再对每一个搬出的节点递归清洗。旧实现只搬出就结束，
    // 被不允许标签包裹的 `<img onerror>` 会原样保留。
    const movedChildren = Array.from(element.childNodes);
    for (const child of movedChildren) {
      parent.insertBefore(child, element);
    }
    parent.removeChild(element);

    for (const child of movedChildren) {
      sanitizeNode(child);
    }
    return;
  }

  for (const attribute of [...element.attributes]) {
    const attributeName = attribute.name.toLowerCase();
    const attributeValue = attribute.value.trim().toLowerCase();

    if (attributeName.startsWith('on')) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (attributeValue.startsWith('javascript:')) {
      element.removeAttribute(attribute.name);
    }
  }

  // 快照遍历：子节点可能在递归中被搬走或删除。
  for (const child of Array.from(element.childNodes)) {
    sanitizeNode(child);
  }
}

export function sanitizeMineruTableHtml(html: string): string {
  if (!html.trim() || typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return '';
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(html, 'text/html');

  for (const child of Array.from(documentNode.body.childNodes)) {
    sanitizeNode(child);
  }

  return documentNode.body.innerHTML;
}
