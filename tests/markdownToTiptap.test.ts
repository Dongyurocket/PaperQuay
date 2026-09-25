import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMarkdownToTiptap } = require('../src/shared/markdownToTiptap.cjs');

test('Markdown 解析器重建基础 Tiptap 块和内联节点', () => {
  const doc = parseMarkdownToTiptap(
    '# 标题\n\n段落 **粗体** *斜体* ~~删除~~ `代码` [[双链]] #标签\n\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n> 引用\n\n```js\nconst x = 1;\n```',
  );

  assert.deepEqual(doc.content.map((node: any) => node.type), [
    'heading',
    'paragraph',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
  ]);
  const paragraph = doc.content[1];
  assert.ok(paragraph.content.some((node: any) => node.type === 'wikiLink' && node.attrs.id === '双链'));
  assert.ok(paragraph.content.some((node: any) => node.type === 'hashTag' && node.attrs.tag === '标签'));
  assert.ok(paragraph.content.some((node: any) => node.marks?.[0]?.type === 'bold'));
  assert.ok(paragraph.content.some((node: any) => node.marks?.[0]?.type === 'italic'));
  assert.ok(paragraph.content.some((node: any) => node.marks?.[0]?.type === 'strike'));
  assert.ok(paragraph.content.some((node: any) => node.marks?.[0]?.type === 'code'));
});

test('Markdown 解析器只为已知锚点和文献重建专用节点', () => {
  const doc = parseMarkdownToTiptap(
    '已知 [定位](paperquay://anchor/a1)，未知 [伪造](paperquay://anchor/nope)，引用 [1] [2]\n\n## 参考文献\n\n1. Author. Known Paper[J]. Journal, 2024.\n2. Unknown Paper[J]. Journal, 2024.',
    {
      anchors: [{ id: 'a1' }],
      papers: [{ id: 'p1', title: 'Known Paper' }],
    },
  );
  const paragraph = doc.content[0];
  const anchor = paragraph.content.find((node: any) => node.type === 'noteAnchorLink');
  const reference = paragraph.content.find((node: any) => node.type === 'paperReference');
  assert.deepEqual(anchor.attrs, { anchorId: 'a1', label: '定位' });
  assert.deepEqual(reference.attrs, { paperId: 'p1', label: 'Known Paper' });
  assert.ok(paragraph.content.some((node: any) => node.type === 'text' && node.text.includes('paperquay://anchor/nope')));
  assert.ok(paragraph.content.some((node: any) => node.type === 'text' && node.text.includes('[2]')));
  assert.equal(doc.content.length, 1);
});
