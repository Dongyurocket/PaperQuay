import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

import {
  noteErrorCode,
  noteErrorMessage,
  noteSearchWarningText,
} from '../src/features/notes/notesText.ts';

/**
 * D7-9 收口：真实 Electron IPC 拒绝前缀、阅读侧提炼稳定码、
 * 笔记检索 warning 双语文案，以及 useReaderNotes 显示点的静态护栏。
 */

const require = createRequire(import.meta.url);
const en: <T>(zh: T, enText: T) => T = (_zh, enText) => enText;
const zh: <T>(zhText: T, _en: T) => T = (zhText) => zhText;
const CJK = /[一-鿿]/;

test('noteErrorCode unwraps Electron IPC/Error prefixes from strings and Error objects', () => {
  assert.equal(noteErrorCode('NOTE_CONFLICT: expected 3'), 'NOTE_CONFLICT');
  assert.equal(
    noteErrorCode("Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3"),
    'NOTE_CONFLICT',
  );
  assert.equal(
    noteErrorCode("Error: Error invoking remote method 'paperquay:invoke': Error: PAPER_NOT_FOUND: gone"),
    'PAPER_NOT_FOUND',
  );
  assert.equal(noteErrorCode('Error: FOLDER_NOT_FOUND: missing'), 'FOLDER_NOT_FOUND');
  assert.equal(noteErrorCode('Error: Error: NOTE_CONFLICT: expected 3'), 'NOTE_CONFLICT');

  const wrapped = Object.assign(
    new Error("Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3"),
    { code: 'NOTE_CONFLICT' },
  );
  assert.equal(noteErrorCode(wrapped), 'NOTE_CONFLICT');
  assert.equal(
    noteErrorCode(new Error("Error invoking remote method 'paperquay:invoke': Error: PAPER_NOT_FOUND: gone")),
    'PAPER_NOT_FOUND',
  );

  // 语法上是稳定码但不在映射表里：提取仍成功，展示层回退通用文案。
  assert.equal(noteErrorCode('SOMETHING_UNKNOWN: 后端中文失败'), 'SOMETHING_UNKNOWN');
  assert.equal(noteErrorCode('后端中文错误原文'), null);
  assert.equal(noteErrorCode(''), null);
  assert.equal(noteErrorCode(null), null);
  assert.equal(noteErrorCode(42), null);
});

test('known note codes map bilingually and unknown codes never echo backend text', () => {
  assert.equal(
    noteErrorMessage("Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3", en),
    'Note was updated elsewhere. Refresh and try again.',
  );
  assert.equal(
    noteErrorMessage("Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3", zh),
    '笔记已在别处更新，请刷新后重试',
  );
  assert.equal(noteErrorMessage('PAPER_NOT_FOUND: 文献不存在', en), 'Paper not found or deleted');
  assert.equal(noteErrorMessage('FOLDER_NOT_FOUND: 分类不存在', zh), '分类不存在');

  const unknownEn = noteErrorMessage('SOMETHING_UNKNOWN: 后端中文失败', en);
  assert.equal(unknownEn, 'Operation failed');
  assert.doesNotMatch(unknownEn, CJK);
  assert.doesNotMatch(unknownEn, /后端中文失败/);

  const wrappedUnknown = noteErrorMessage(
    "Error invoking remote method 'paperquay:invoke': Error: BRAND_NEW_CODE: 后端中文失败",
    en,
  );
  assert.equal(wrappedUnknown, 'Operation failed');
  assert.doesNotMatch(wrappedUnknown, CJK);

  const noCode = noteErrorMessage('后端中文错误原文', zh);
  assert.equal(noCode, '操作失败');
  assert.doesNotMatch(noCode, /后端中文错误原文/);
});

test('distill error codes map bilingually', () => {
  assert.equal(
    noteErrorMessage('NOTE_DISTILL_MODEL_MISSING', en),
    'Configure a QA or agent model in model settings first',
  );
  assert.equal(
    noteErrorMessage('NOTE_DISTILL_MODEL_MISSING', zh),
    '请先在模型设置中配置可用的问答或 Agent 模型',
  );
  assert.equal(noteErrorMessage('NOTE_DISTILL_FAILED: upstream 500', en), 'Failed to distill the excerpt');
  assert.equal(noteErrorMessage('NOTE_DISTILL_FAILED: upstream 500', zh), '提炼摘录失败');
});

test('noteSearchWarningText maps known backend warnings and never returns raw text', () => {
  const known = [
    {
      warning: 'Embedding 未在 PaperQuay 中配置，已降级为关键词检索。',
      en: /Embedding is not configured; using keyword search\./,
      zh: /Embedding 未配置，已降级为关键词检索。/,
    },
    {
      warning: '笔记库没有与当前模型及正文版本匹配的向量结果，已降级为关键词检索。',
      en: /No matching vectors; using keyword search\./,
      zh: /没有匹配的向量结果，已降级为关键词检索。/,
    },
    {
      warning: '向量检索失败，已降级为关键词检索：TypeError: fetch failed',
      en: /Vector search failed; using keyword search\./,
      zh: /向量检索失败，已降级为关键词检索。/,
    },
  ];

  for (const item of known) {
    const enText = noteSearchWarningText(item.warning, en);
    assert.ok(enText);
    assert.match(enText, item.en);
    assert.doesNotMatch(enText, CJK, `English warning leaked Chinese: ${enText}`);
    assert.doesNotMatch(enText, /fetch failed/);

    const zhText = noteSearchWarningText(item.warning, zh);
    assert.ok(zhText);
    assert.match(zhText, item.zh);
  }

  const unknownEn = noteSearchWarningText('自定义后端提示：索引损坏', en);
  assert.equal(unknownEn, 'Semantic search is unavailable; results may be keyword-only.');
  assert.doesNotMatch(unknownEn ?? '', CJK);
  assert.doesNotMatch(unknownEn ?? '', /索引损坏/);

  const unknownZh = noteSearchWarningText('自定义后端提示：索引损坏', zh);
  assert.equal(unknownZh, '语义检索暂不可用，结果可能仅来自关键词。');
  assert.doesNotMatch(unknownZh ?? '', /索引损坏/);

  assert.equal(noteSearchWarningText(undefined, en), null);
  assert.equal(noteSearchWarningText('', en), null);
  assert.equal(noteSearchWarningText('   ', en), null);
});

async function loadDistillBundle(): Promise<{ distillExcerpt: (request: Record<string, unknown>) => Promise<unknown> }> {
  const mocks: Record<string, string> = {
    './modelPresets': 'export const loadQaModelPreset = async () => globalThis.__distillModel;',
    './blockReparse': 'export const reparseBlockWithAi = async (request) => globalThis.__distillReparse(request);',
    '../platform/electron/core': 'export const invoke = async (...args) => globalThis.__distillInvoke(...args);',
  };
  const bundle = await build({
    entryPoints: ['src/services/noteDistill.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'note-distill-test-mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => (
          mocks[args.path] ? { path: args.path, namespace: 'distill-mock' } : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: 'distill-mock' }, (args) => ({
          contents: mocks[args.path],
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports as { distillExcerpt: (request: Record<string, unknown>) => Promise<unknown> };
}

test('distillExcerpt throws stable-code errors instead of Chinese messages', async () => {
  const { distillExcerpt } = await loadDistillBundle();
  const globals = globalThis as Record<string, unknown>;
  globals.__distillInvoke = async () => ({ title: 't', text: 'x' });
  try {
    globals.__distillModel = null;
    await assert.rejects(distillExcerpt({ text: 'x' }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(noteErrorCode(error), 'NOTE_DISTILL_MODEL_MISSING');
      assert.match(error.message, /^NOTE_DISTILL_MODEL_MISSING\b/);
      assert.doesNotMatch(error.message, CJK);
      return true;
    });

    globals.__distillModel = { apiKey: 'key', baseUrl: 'https://example.test/v1', model: 'model' };
    globals.__distillInvoke = async () => {
      throw new Error("Error invoking remote method 'paperquay:invoke': Error: upstream exploded");
    };
    await assert.rejects(distillExcerpt({ text: 'x' }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(noteErrorCode(error), 'NOTE_DISTILL_FAILED');
      assert.match(error.message, /^NOTE_DISTILL_FAILED: .*upstream exploded/);
      return true;
    });

    const calls: unknown[][] = [];
    globals.__distillInvoke = async (...args: unknown[]) => {
      calls.push(args);
      return { title: 't', text: 'x' };
    };
    assert.deepEqual(await distillExcerpt({ text: 'x' }), { title: 't', text: 'x' });
    assert.equal(calls[0]?.[0], 'notes_distill_excerpt_openai_compatible');
  } finally {
    delete globals.__distillModel;
    delete globals.__distillInvoke;
  }
});

async function loadNotesServiceBundle(): Promise<{
  createNote: (request: unknown, options?: unknown) => Promise<unknown>;
  NoteServiceError: new (...args: unknown[]) => Error & { code: string };
}> {
  const mocks: Record<string, string> = {
    '../platform/electron/core.ts': 'export const invoke = async (...args) => globalThis.__notesInvoke(...args);',
    '../app/appEvents.ts': 'export const emitNoteChanged = () => {};',
    '../features/notes/noteUtils.ts': 'export const collectPagedNotes = async () => [];',
  };
  const bundle = await build({
    entryPoints: ['src/services/notes.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'notes-service-test-mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => (
          mocks[args.path] ? { path: args.path, namespace: 'notes-service-mock' } : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: 'notes-service-mock' }, (args) => ({
          contents: mocks[args.path],
          loader: 'js',
        }));
      },
    }],
  });
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports as never;
}

test('toNoteServiceError keeps backend stable codes from wrapped IPC rejections', async () => {
  const { createNote, NoteServiceError } = await loadNotesServiceBundle();
  const globals = globalThis as Record<string, unknown>;
  try {
    globals.__notesInvoke = async () => {
      throw new Error("Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3");
    };
    await assert.rejects(createNote({}), (error: unknown) => {
      assert.ok(error instanceof NoteServiceError);
      assert.equal(error.code, 'NOTE_CONFLICT');
      assert.match(error.message, /^NOTE_CONFLICT: /);
      assert.match(error.message, /expected 3/);
      return true;
    });

    globals.__notesInvoke = async () => {
      throw new Error("Error invoking remote method 'paperquay:invoke': Error: WEIRD_BACKEND_CODE: detail");
    };
    await assert.rejects(createNote({}), (error: unknown) => {
      assert.ok(error instanceof NoteServiceError);
      assert.equal(error.code, 'WEIRD_BACKEND_CODE');
      return true;
    });

    globals.__notesInvoke = async () => {
      throw 'offline';
    };
    await assert.rejects(createNote({}), (error: unknown) => {
      assert.ok(error instanceof NoteServiceError);
      assert.equal(error.code, 'NOTE_CREATE_FAILED');
      return true;
    });
  } finally {
    delete globals.__notesInvoke;
  }
});

test('useReaderNotes renders distill failures through noteErrorMessage (static guard)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/reader/hooks/useReaderNotes.ts'),
    'utf8',
  );
  // 静态护栏：蒸馏失败的两个显示点（直接状态提示 + 重识别回退提示）必须走双语映射，
  // 不能再把后端/模型原始 message 拼进界面。
  const statusCalls = source.match(/setStatusMessage\(noteErrorMessage\((?:error|fallbackError), lRef\.current\)\)/g) ?? [];
  assert.equal(statusCalls.length, 2, 'expected both distill status calls to use noteErrorMessage');
  assert.match(
    source,
    /重识别失败，已回退纯文本提炼：\$\{noteErrorMessage\(error, lRef\.current\)\}/,
  );
  assert.match(
    source,
    /fell back to text-only distillation: \$\{noteErrorMessage\(error, lRef\.current\)\}/,
  );
  assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /fallbackError\.message/);
});

test('noteDistill source no longer throws raw Chinese messages (static guard)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/noteDistill.ts'), 'utf8');
  assert.match(source, /NOTE_DISTILL_MODEL_MISSING/);
  assert.match(source, /NOTE_DISTILL_FAILED/);
  assert.doesNotMatch(source, /throw new Error\('请先在模型设置中配置可用的问答或 Agent 模型。'\)/);
});
