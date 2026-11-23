import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');

const commands = createAiCommands({});

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendChat(response, content, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

function parseBlocks(bodyText) {
  const body = JSON.parse(bodyText);
  const userMessage = body.messages[body.messages.length - 1];
  return JSON.parse(userMessage.content).blocks;
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function makeBlocks(count) {
  return Array.from({ length: count }, (_, index) => ({
    blockId: `block-${index}`,
    text: `Evidence paragraph ${index}.`,
  }));
}

test('translation batches 500 blocks into a bounded number of requests', async () => {
  let requestCount = 0;
  const { server, port } = await startServer(async (request, response) => {
    requestCount += 1;
    const blocks = parseBlocks(await readBody(request));
    sendChat(
      response,
      JSON.stringify({
        blocks: blocks.map((block) => ({
          blockId: block.blockId,
          translatedText: `翻译：${block.text}`,
        })),
      }),
    );
  });

  try {
    const blocks = makeBlocks(500);
    const outputs = await commands.translate_blocks_openai_compatible({
      options: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        model: 'test-model',
        sourceLanguage: 'English',
        targetLanguage: 'Simplified Chinese',
        blocks,
        requestId: 'batch-request',
        requestsPerMinute: 0,
      },
    });

    assert.equal(outputs.length, 500);
    assert.ok(outputs.every((output) => output.translatedText.startsWith('翻译：')));
    assert.equal(requestCount, 25, '500 blocks must become 25 batched requests, not 500');
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('translate_cancel aborts the in-flight request and stops further batches', async () => {
  let requestCount = 0;
  const { server, port } = await startServer(async (request, _response) => {
    requestCount += 1;
    await readBody(request);
    // 故意不响应，等待取消。
  });

  try {
    const pending = commands.translate_blocks_openai_compatible({
      options: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        model: 'test-model',
        sourceLanguage: 'English',
        targetLanguage: 'Simplified Chinese',
        blocks: makeBlocks(40),
        requestId: 'cancel-request',
        requestsPerMinute: 0,
      },
    });

    for (let attempt = 0; attempt < 100 && requestCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requestCount, 1);

    const cancelled = await commands.translate_cancel({ requestId: 'cancel-request' });
    assert.equal(cancelled.cancelled, true);

    await assert.rejects(pending, /TRANSLATION_CANCELLED/);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(requestCount, 1, 'no new requests may start after cancellation');

    const unknown = await commands.translate_cancel({ requestId: 'missing' });
    assert.equal(unknown.cancelled, false);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('transient HTTP failures are retried with backoff before falling back', async () => {
  let requestCount = 0;
  const { server, port } = await startServer(async (request, response) => {
    requestCount += 1;
    if (requestCount <= 2) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'temporary' }));
      return;
    }
    const blocks = parseBlocks(await readBody(request));
    sendChat(
      response,
      JSON.stringify({
        blocks: blocks.map((block) => ({ blockId: block.blockId, translatedText: `ok-${block.blockId}` })),
      }),
    );
  });

  try {
    const outputs = await commands.translate_blocks_openai_compatible({
      options: {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        model: 'test-model',
        sourceLanguage: 'English',
        targetLanguage: 'Simplified Chinese',
        blocks: makeBlocks(4),
        requestId: 'retry-request',
        requestsPerMinute: 0,
      },
    });

    assert.equal(requestCount, 3);
    assert.equal(outputs.length, 4);
    assert.ok(outputs.every((output) => output.translatedText.startsWith('ok-')));
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test('a hanging request times out with a retryable error instead of blocking forever', async () => {
  const { server, port } = await startServer(async (request, _response) => {
    await readBody(request);
    // 永不响应：只能由请求 deadline 结束。
  });

  try {
    await assert.rejects(
      commands.translate_blocks_openai_compatible({
        options: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'test-key',
          model: 'test-model',
          sourceLanguage: 'English',
          targetLanguage: 'Simplified Chinese',
          blocks: makeBlocks(2),
          requestId: 'timeout-request',
          requestsPerMinute: 0,
          requestTimeoutMs: 300,
        },
      }),
      /AGENT_MODEL_TIMEOUT|timed out/i,
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
