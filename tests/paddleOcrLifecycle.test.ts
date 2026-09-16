import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { createPaddleOcrCommands } = require('../electron/backend/paddleOcrCommands.cjs');

async function setup(t: any) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-paddle-lifecycle-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  const pdfPath = path.join(directory, 'fixture.pdf');
  await fsp.writeFile(pdfPath, await pdf.save());
  const commands = createPaddleOcrCommands({ appPaths: { mineruCacheDir: directory } });
  const options = {
    pdfPath, extractDir: path.join(directory, 'parse'), documentKey: 'fixture', taskId: 'fixture-task',
    apiToken: 'fixture-secret', timeoutSecs: 20, pollIntervalSecs: 1, requestTimeoutMs: 1000,
  };
  return { commands, options };
}

function cloudResponse(url: string) {
  if (url.endsWith('/jobs')) return Response.json({ data: { jobId: 'fixture-job' } });
  if (url.endsWith('/jobs/fixture-job')) return Response.json({ data: {
    state: 'done', resultUrl: { jsonUrl: 'https://example.invalid/result.jsonl?secret=signed' },
    extractProgress: { extractedPages: 1, totalPages: 1 },
  } });
  return null;
}

test('Paddle command publishes success only after the readable result is saved', async (t) => {
  const { commands, options } = await setup(t);
  const events: any[] = [];
  const completedFiles: boolean[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? Response.json({ result: {
    layoutParsingResults: [{
      prunedResult: { width: 600, height: 800, parsing_res_list: [
        { block_label: 'text', block_content: 'A preserved paragraph.', block_bbox: [20, 20, 500, 80] },
      ] },
      markdown: { text: 'A preserved paragraph.', images: {} },
    }],
  } }));
  const result = await commands.run_paddleocr_cloud_parse({ options }, { sender: {
    isDestroyed: () => false,
    send: (_channel: string, _eventName: string, task: any) => {
      events.push(task);
      if (task.status === 'success') completedFiles.push(fs.existsSync(task.contentJsonPath));
    },
  } });
  assert.deepEqual(completedFiles, [true]);
  assert.match(await fsp.readFile(result.contentJsonPath, 'utf8'), /A preserved paragraph/);
  const snapshot = await commands.list_paddleocr_parse_tasks();
  assert.equal(snapshot[0].status, 'success');
  assert.equal(snapshot[0].blockCount, 1);
  assert.ok(events.some((event) => event.stage === 'downloading'));
  assert.ok(events.some((event) => event.stage === 'saving'));
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-secret|secret=signed|contentJsonText/);
});

test('a stalled result body reaches error after tab closure without using an old cache as success', async (t) => {
  const { commands, options } = await setup(t);
  await fsp.mkdir(options.extractDir, { recursive: true });
  await fsp.writeFile(path.join(options.extractDir, 'content_list_v2.json'), 'old cached result');
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? {
    ok: true, text: () => new Promise(() => {}),
  } as Response);
  await assert.rejects(commands.run_paddleocr_cloud_parse({ options: { ...options, requestTimeoutMs: 20 } }, {
    sender: { isDestroyed: () => true },
  }), /超时/);
  const snapshot = await commands.list_paddleocr_parse_tasks();
  assert.equal(snapshot[0].status, 'error');
  assert.equal(snapshot[0].contentJsonPath, undefined);
  assert.equal(await fsp.readFile(path.join(options.extractDir, 'content_list_v2.json'), 'utf8'), 'old cached result');
});
