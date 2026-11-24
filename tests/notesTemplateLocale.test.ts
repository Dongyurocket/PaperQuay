import test from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';

import {
  NOTE_TEMPLATES,
  templateContentForLocale,
} from '../src/features/notes/noteEditorUtils.ts';

const CJK_PATTERN = /[一-鿿]/;

function collectTexts(nodes: JSONContent[]): string[] {
  return nodes.flatMap((node) => [
    ...(typeof node.text === 'string' ? [node.text] : []),
    ...(node.content ? collectTexts(node.content) : []),
  ]);
}

/** 只比较节点形状（类型、标题级别、任务勾选状态、子节点数量），不比较文案。 */
function nodeShape(nodes: JSONContent[]): unknown[] {
  return nodes.map((node) => ({
    type: node.type,
    level: node.attrs?.level ?? null,
    checked: node.attrs?.checked ?? null,
    content: node.content ? nodeShape(node.content) : [],
  }));
}

test('每个模板都提供与中文结构一致的英文正文，且英文正文不含中文', () => {
  for (const template of NOTE_TEMPLATES) {
    assert.ok(Array.isArray(template.contentEn), `${template.id} must expose contentEn`);
    assert.ok(template.contentEn.length > 0, `${template.id} contentEn must not be empty`);
    assert.deepEqual(
      nodeShape(template.contentEn),
      nodeShape(template.content),
      `${template.id} contentEn must mirror the Chinese node structure`,
    );

    const englishText = collectTexts(template.contentEn).join('\n');
    assert.doesNotMatch(englishText, CJK_PATTERN, `${template.id} contentEn must not contain Chinese`);
    assert.ok(englishText.trim().length > 0, `${template.id} contentEn must carry text`);
  }
});

test('templateContentForLocale 按界面语言选择正文，未知语言回退中文', () => {
  for (const template of NOTE_TEMPLATES) {
    assert.equal(templateContentForLocale(template, 'en-US'), template.contentEn);
    assert.equal(templateContentForLocale(template, 'zh-CN'), template.content);
    assert.equal(templateContentForLocale(template, null), template.content);
    assert.equal(templateContentForLocale(template, undefined), template.content);
  }
});
