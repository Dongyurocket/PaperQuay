import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createBlockReparseStorageKey, loadBlockReparseOverrides, saveBlockReparseOverride } from '../src/services/blockReparseOverrides.ts';
import type { PositionedMineruBlock } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const commands = createAiCommands({});
const image = 'data:image/png;base64,iVBORw0KGgo=';
const options = { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'vision-test', supportsVision: true };
function fakeReply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

test('reparse sends image and reference OCR in one request, preserving mixed structures', async (t) => {
  const bodies: any[] = [];
  const expected = 'A paragraph with $V_{net}$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$x^2$$';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return fakeReply(expected);
  });
  const output = await commands.reparse_block_openai_compatible({ options: { ...options, text: 'OCR reference', imageDataUrl: image } });
  assert.equal(output, expected);
  assert.equal(bodies.length, 1);
  const messages = bodies[0].messages;
  assert.match(messages[0].content, /original PDF crop/);
  assert.match(messages[0].content, /Never turn narrative prose into a symbol table/);
  assert.deepEqual(messages[1].content, [
    { type: 'text', text: 'OCR reference (may contain errors):\nOCR reference' },
    { type: 'image_url', image_url: { url: image } },
  ]);
});

test('text-only repair does not inject image content or legacy modes', async (t) => {
  let body: any;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return fakeReply('This is a paragraph with $\\gamma$.');
  });
  await commands.reparse_block_openai_compatible({ options: { ...options, supportsVision: false, text: 'This is a paragraph.', mode: 'table' } });
  assert.equal(typeof body.messages[1].content, 'string');
  assert.match(body.messages[0].content, /TEXT REPAIR ONLY/);
  assert.doesNotMatch(body.messages[0].content, /SPECIAL MODE/);
});

test('image-only blocks are recognizable without reference text', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => fakeReply('$$E=mc^2$$'));
  assert.equal(await commands.reparse_block_openai_compatible({ options: { ...options, imageDataUrl: image } }), '$$E=mc^2$$');
});

test('vision rejection propagates after exactly one request without a text fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'image input not supported' } }), { status: 400 });
  });
  await assert.rejects(commands.reparse_block_openai_compatible({ options: { ...options, text: 'reference', imageDataUrl: image } }), /400|image input not supported/);
  assert.equal(calls, 1);
});

test('invalid images and unavailable vision are rejected before any network request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return fakeReply('unexpected'); });
  await assert.rejects(commands.reparse_block_openai_compatible({ options: { ...options, supportsVision: false, imageDataUrl: image } }), /视觉/);
  await assert.rejects(commands.reparse_block_openai_compatible({ options: { ...options, imageDataUrl: 'https://untrusted.invalid/image.png' } }), /图片数据/);
  await assert.rejects(commands.reparse_block_openai_compatible({ options: { ...options, text: '' } }), /文本或 PDF 切片/);
  assert.equal(calls, 0);
});

test('Responses API receives an input_image and reference text', async (t) => {
  let body: any;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'repaired' }] }] }), { status: 200 });
  });
  const result = await commands.reparse_block_openai_compatible({ options: { ...options, apiMode: 'responses', text: 'OCR', imageDataUrl: image } });
  assert.equal(result, 'repaired');
  const user = body.input.find((message: any) => message.role === 'user');
  assert.ok(user.content.some((part: any) => part.type === 'input_image' && part.image_url === image));
  assert.ok(user.content.some((part: any) => part.type === 'input_text' && part.text.includes('OCR')));
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const blocks: PositionedMineruBlock[] = [{ blockId: 'p0-b0', pageIndex: 0, blockIndex: 0, type: 'paragraph', content: 'original', bbox: [1, 2, 30, 40] }];

test('saved overrides survive reload, preserve other edits and restore the original', async () => {
  const storage = memoryStorage();
  const key = await createBlockReparseStorageKey('local:paper.pdf', 'parse/content.json', blocks);
  saveBlockReparseOverride(storage, key, 'p0-b0', 'Repaired $x$');
  saveBlockReparseOverride(storage, key, 'p0-b1', 'Another repair');
  const reloadedKey = await createBlockReparseStorageKey('local:paper.pdf', 'parse/content.json', structuredClone(blocks));
  assert.equal(reloadedKey, key);
  assert.equal(loadBlockReparseOverrides(storage, reloadedKey)['p0-b0'], 'Repaired $x$');
  assert.deepEqual(saveBlockReparseOverride(storage, key, 'p0-b0', null), { 'p0-b1': 'Another repair' });
  saveBlockReparseOverride(storage, key, 'p0-b1', null);
  assert.equal(storage.getItem(key), null);
});

test('document identity, changed parse text, geometry and block ordering isolate repairs', async () => {
  const storage = memoryStorage();
  const key = await createBlockReparseStorageKey('local:a.pdf', 'parse/content.json', blocks);
  saveBlockReparseOverride(storage, key, 'p0-b0', 'Repair for a only');
  const variants = [
    await createBlockReparseStorageKey('local:b.pdf', 'parse/content.json', blocks),
    await createBlockReparseStorageKey('local:a.pdf', 'another/content.json', blocks),
    await createBlockReparseStorageKey('local:a.pdf', 'parse/content.json', [{ ...blocks[0], content: 'new OCR' }]),
    await createBlockReparseStorageKey('local:a.pdf', 'parse/content.json', [{ ...blocks[0], bbox: [10, 20, 30, 40] }]),
    await createBlockReparseStorageKey('local:a.pdf', 'parse/content.json', [{ ...blocks[0], blockIndex: 1 }]),
  ];
  for (const variant of variants) {
    assert.notEqual(variant, key);
    assert.deepEqual(loadBlockReparseOverrides(storage, variant), {});
  }
});

test('storage quota or malformed data fails explicitly instead of reporting saved repair', () => {
  const storage = memoryStorage();
  storage.setItem('key', '{invalid');
  assert.throws(() => loadBlockReparseOverrides(storage, 'key'));
  assert.throws(() => saveBlockReparseOverride({ ...storage, setItem() { throw new Error('quota'); } }, 'new', 'block', 'repair'), /quota/);
});
