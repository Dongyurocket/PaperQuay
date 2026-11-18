import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const bundle = await build({
  entryPoints: ['src/services/qa.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const { askDocumentOpenAICompatibleStream } = compiled.exports;

test('reader QA abort travels through the bridge and ignores other request events', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const commands = createAiCommands({});
  const controller = new AbortController();
  const deltas = [];
  let eventHandler;
  let requestSignal;
  let requestId;
  let unlistened = false;
  const sender = { id: 42, send(_channel, event, payload) { eventHandler?.({ event, payload }); } };
  globalThis.window = { paperquay: {
    async listen(_event, handler) {
      eventHandler = handler;
      return () => { unlistened = true; eventHandler = undefined; };
    },
    invoke(command, args) {
      if (command === 'ask_document_openai_compatible_stream') requestId = args.requestId;
      return commands[command](args, { sender });
    },
  } };
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return new Promise((_resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
  };
  try {
    const pending = askDocumentOpenAICompatibleStream({
      baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'model', title: 'Paper', messages: [],
    }, { onDelta: (_delta, text) => deltas.push(text) }, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(requestSignal);
    sender.send('paperquay:event', 'paperquay://qa-stream', { requestId: 'other', kind: 'delta', text: 'wrong' });
    sender.send('paperquay:event', 'paperquay://qa-stream', { requestId, kind: 'delta', text: 'right' });
    assert.deepEqual(deltas, ['right']);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
    assert.equal(unlistened, true);
    assert.equal(await commands.ask_document_openai_compatible_stream_cancel({ requestId }, { sender }), false);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('reader QA keeps the completed answer when stream events arrive after IPC completion', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const commands = createAiCommands({});
  let listener;
  const lateEvents = [];
  const sender = { id: 43, send(_channel, event, payload) { lateEvents.push({ event, payload }); } };
  globalThis.window = { paperquay: {
    async listen(_event, handler) {
      listener = handler;
      return () => { listener = undefined; };
    },
    invoke(command, args) {
      assert.equal(command, 'ask_document_openai_compatible_stream');
      return commands[command](args, { sender });
    },
  } };
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
  try {
    const answer = await askDocumentOpenAICompatibleStream({
      baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'model', title: 'Paper', messages: [],
    });
    assert.ok(lateEvents.some((event) => event.payload.kind === 'delta'));
    lateEvents.forEach((event) => listener?.(event));
    assert.equal(answer, 'Answer');
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('reader QA reports an empty model stream instead of leaving a blank answer', async () => {
  const previousFetch = globalThis.fetch;
  const commands = createAiCommands({});
  globalThis.fetch = async () => new Response('data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
  try {
    await assert.rejects(commands.ask_document_openai_compatible_stream({
      requestId: 'empty', options: { baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'model', title: 'Paper', messages: [] },
    }, { sender: { id: 44, send() {} } }), /模型未返回可用的问答内容/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
