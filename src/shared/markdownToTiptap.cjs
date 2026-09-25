// Shared by Vite and Electron. Markdown is an interchange format, not the note store.
function parseMarkdownToTiptap(markdown, options = {}) {
  const anchors = new Set((options.anchors || []).map((anchor) => anchor.id));
  const papers = options.papers || [];
  const notes = options.notes || [];
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const refs = new Map();
  const refHeading = lines.findIndex((line) => /^#{1,6}\s+参考文献\s*$/.test(line));
  if (refHeading >= 0) {
    for (const line of lines.slice(refHeading + 1)) {
      if (!line.trim()) continue;
      const match = line.match(/^(\d+)\.\s+(.+)$/);
      if (!match) continue;
      const entry = match[2].trim();
      const matching = papers.filter((paper) =>
        (paper.doi && entry.toLowerCase().includes(`doi: ${paper.doi}`.toLowerCase())) ||
        (paper.title && entry.includes(paper.title)));
      if (matching.length === 1) refs.set(Number(match[1]), matching[0]);
    }
    lines.splice(refHeading);
  }

  function inline(source) {
    const result = [];
    function text(value, marks) {
      if (!value) return;
      const last = result[result.length - 1];
      if (last?.type === 'text' && JSON.stringify(last.marks || []) === JSON.stringify(marks || [])) {
        last.text += value;
      } else result.push({ type: 'text', text: value, ...(marks?.length ? { marks } : {}) });
    }
    function append(nodes, marks) {
      for (const node of nodes) {
        if (node.type === 'text') text(node.text, [...(node.marks || []), ...marks]);
        else result.push(node);
      }
    }
    let i = 0;
    while (i < source.length) {
      const rest = source.slice(i);
      const escaped = rest.match(/^\\([\\`*_[\]#~])/);
      if (escaped) { text(escaped[1]); i += escaped[0].length; continue; }
      const anchor = rest.match(/^\[([^\]\n]+)\]\(paperquay:\/\/anchor\/([^)]+)\)/);
      if (anchor) {
        if (anchors.has(anchor[2])) result.push({ type: 'noteAnchorLink', attrs: { anchorId: anchor[2], label: anchor[1] } });
        else text(anchor[0]);
        i += anchor[0].length; continue;
      }
      const wiki = rest.match(/^\[\[([^\]\n]{1,160})\]\]/);
      if (wiki) {
        const label = wiki[1].trim();
        const targets = notes.filter((note) => note.title?.toLocaleLowerCase() === label.toLocaleLowerCase());
        const target = targets.length === 1 ? targets[0] : null;
        result.push({
          type: 'wikiLink',
          attrs: {
            noteId: target?.id || null,
            id: target?.id || label,
            label,
          },
        });
        i += wiki[0].length; continue;
      }
      const ref = rest.match(/^\[(\d+)\](?!\()/);
      if (ref) {
        const paper = refs.get(Number(ref[1]));
        if (paper) result.push({ type: 'paperReference', attrs: { paperId: paper.id, label: paper.title || paper.id } });
        else text(ref[0]);
        i += ref[0].length; continue;
      }
      const tag = (i === 0 || /[\s([{"'，。；、]/.test(source[i - 1])) && rest.match(/^#([\p{L}\p{N}_-]+)/u);
      if (tag) {
        result.push({ type: 'hashTag', attrs: { tag: tag[1] } });
        i += tag[0].length; continue;
      }
      const link = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
      if (link) {
        append(inline(link[1]), [{ type: 'link', attrs: { href: link[2] } }]);
        i += link[0].length; continue;
      }
      const marked = [
        ['**', 'bold'], ['~~', 'strike'], ['*', 'italic'], ['_', 'italic'], ['`', 'code'],
      ].find(([delimiter]) => rest.startsWith(delimiter) && rest.indexOf(delimiter, delimiter.length) > delimiter.length);
      if (marked) {
        const [delimiter, type] = marked;
        const end = rest.indexOf(delimiter, delimiter.length);
        const body = rest.slice(delimiter.length, end);
        if (type === 'code') text(body, [{ type }]);
        else append(inline(body), [{ type }]);
        i += end + delimiter.length; continue;
      }
      text(source[i]); i += 1;
    }
    return result;
  }

  function blocks(input) {
    const result = [];
    const isSpecial = (line) => /^(?:#{1,6}\s|>\s?|```|~~~|[-*+]\s|\d+\.\s|---\s*$)/.test(line);
    for (let i = 0; i < input.length;) {
      const line = input[i];
      if (!line.trim()) { i += 1; continue; }
      const fence = line.match(/^(```|~~~)(.*)$/);
      if (fence) {
        const code = [];
        i += 1;
        while (i < input.length && !input[i].startsWith(fence[1])) code.push(input[i++]);
        if (i < input.length) i += 1;
        result.push({ type: 'codeBlock', attrs: { language: fence[2].trim() || null }, content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] });
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        result.push({ type: 'heading', attrs: { level: heading[1].length }, content: inline(heading[2]) });
        i += 1; continue;
      }
      if (/^---\s*$/.test(line)) { result.push({ type: 'horizontalRule' }); i += 1; continue; }
      if (/^>\s?/.test(line)) {
        const quoted = [];
        while (i < input.length && /^>\s?/.test(input[i])) quoted.push(input[i++].replace(/^>\s?/, ''));
        const parsed = blocks(quoted);
        result.push({ type: 'blockquote', content: parsed.length ? parsed : [{ type: 'paragraph' }] });
        continue;
      }
      const list = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (list) {
        const ordered = /^\d/.test(list[2]);
        const items = [];
        const indent = list[1].length;
        while (i < input.length) {
          const item = input[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
          i += 1;
          const body = [item[3]];
          while (i < input.length && input[i].startsWith(' '.repeat(indent + 2)) && input[i].trim()) {
            body.push(input[i++].slice(indent + 2));
          }
          items.push({ type: 'listItem', content: blocks(body) });
        }
        result.push({ type: ordered ? 'orderedList' : 'bulletList', ...(ordered ? { attrs: { start: Number(list[2].slice(0, -1)) } } : {}), content: items });
        continue;
      }
      const paragraph = [line];
      i += 1;
      while (i < input.length && input[i].trim() && !isSpecial(input[i])) paragraph.push(input[i++]);
      result.push({ type: 'paragraph', content: inline(paragraph.join('\n')) });
    }
    return result;
  }
  const content = blocks(lines);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

module.exports = { parseMarkdownToTiptap };
