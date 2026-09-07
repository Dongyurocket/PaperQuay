import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeScriptComposition,
  containsCjk,
  isChineseDominant,
  isChineseLanguage,
  normalizeLanguageCode,
} from '../src/utils/languageDetect.ts';

test('languageDetect analyzes script composition', () => {
  const mixed = analyzeScriptComposition('基于深度学习的 fault diagnosis 方法');
  assert.ok(mixed.cjk > 0);
  assert.ok(mixed.latin > 0);

  assert.deepEqual(analyzeScriptComposition(''), { cjk: 0, latin: 0 });
});

test('languageDetect detects CJK presence', () => {
  assert.equal(containsCjk('滚动轴承故障诊断'), true);
  assert.equal(containsCjk('Deep learning for fault diagnosis'), false);
  assert.equal(containsCjk(''), false);
  assert.equal(containsCjk(null), false);
  assert.equal(containsCjk(undefined), false);
});

test('languageDetect detects Chinese-dominant documents', () => {
  assert.equal(
    isChineseDominant('本文提出了一种基于深度学习的滚动轴承故障诊断方法，实验结果表明该方法在多个数据集上有效。'),
    true,
  );
  // 中文论文中夹杂较多英文术语时仍判定为中文。
  assert.equal(
    isChineseDominant('本文提出基于 transformer 和 attention mechanism 的故障诊断方法，在 benchmark 数据集上验证有效。'),
    true,
  );
  // 英文文献中引用个别中文词汇不误判。
  assert.equal(
    isChineseDominant('Deep learning has been widely applied to fault diagnosis. Recent surveys (故障诊断) summarize advances in this field.'),
    false,
  );
  assert.equal(isChineseDominant('Deep learning for remaining useful life prediction'), false);
  assert.equal(isChineseDominant(''), false);
  assert.equal(isChineseDominant(null), false);
  assert.equal(isChineseDominant(undefined), false);
  // 少量中文字符（不足阈值）不判定为中文文献。
  assert.equal(isChineseDominant('机械'), false);
});

test('languageDetect normalizes language codes', () => {
  assert.equal(normalizeLanguageCode('Chinese'), 'zh');
  assert.equal(normalizeLanguageCode('Simplified Chinese'), 'zh');
  assert.equal(normalizeLanguageCode('简体中文'), 'zh');
  assert.equal(normalizeLanguageCode('zh-CN'), 'zh');
  assert.equal(normalizeLanguageCode('zh'), 'zh');
  assert.equal(normalizeLanguageCode('English'), 'en');
  assert.equal(normalizeLanguageCode('en-US'), 'en');
  assert.equal(normalizeLanguageCode('Japanese'), 'japanese');
  assert.equal(normalizeLanguageCode(''), '');
  assert.equal(normalizeLanguageCode(null), '');
});

test('languageDetect identifies Chinese language settings', () => {
  assert.equal(isChineseLanguage('Chinese'), true);
  assert.equal(isChineseLanguage('Simplified Chinese'), true);
  assert.equal(isChineseLanguage('zh-CN'), true);
  assert.equal(isChineseLanguage('English'), false);
  assert.equal(isChineseLanguage('Japanese'), false);
  assert.equal(isChineseLanguage(null), false);
});
