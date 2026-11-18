import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

async function loadRunner(provider: string) {
  const bundle = await build({ stdin: {
    contents: `export {runConversationalLibraryAgent} from './src/services/libraryAgent.ts';
      export {calls} from './src/services/agentChat';`, resolveDir: process.cwd(), loader: 'ts',
  }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(import.meta.url) },
    plugins: [{ name: 'fake-stream-provider', setup(builder) {
      builder.onResolve({ filter: /\/agentChat$|^\.\/agentChat$/ }, () => ({ path: 'provider', namespace: 'test-provider' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-provider' }, () => ({ contents: `
        export const calls = [];
        export async function runOpenAiCompatibleAgentChatTurn(request) {
          calls.push(request);
          ${provider}
        }`, loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

const paper = { id: 'paper-a', title: 'Rotor', titleZh: null, year: null, publication: null, doi: null,
  abstractText: null, aiSummary: null, userNote: null, citation: null, authors: [], keywords: [], tags: [], categoryIds: [], attachments: [] };
const preset = { baseUrl: 'https://example.test', apiKey: 'fixture', model: 'fixture', contextWindow: 1_000_000, supportsVision: false };

test('the actual service exposes each streamed answer as a separate turn draft', async () => {
  const { runConversationalLibraryAgent, calls } = await loadRunner(`
    if (calls.length === 1) {
      request.onAnswerDelta?.('Inspecting the paper.');
      return { content: 'Inspecting the paper.', toolCalls: [{id:'search-1',name:'search_library',arguments:{query:'Rotor'}}], finishReason:'tool_calls' };
    }
    request.onAnswerDelta?.('Final answer.');
    return { content:'Final answer.', finishReason:'stop' };
  `);
  const drafts: Array<{ text: string; fullText: string; turn?: number }> = [];
  const result = await runConversationalLibraryAgent({ papers: [paper], instruction: 'Answer the question.', preset,
    streamHandlers: { onDelta: (text: string, fullText: string, turn?: number) => drafts.push({ text, fullText, turn }) } });
  assert.equal(result.answer, 'Final answer.');
  assert.match(result.ragNotice, /当次文献范围：1 篇/);
  assert.match(result.ragNotice, /本次运行未执行本地 RAG 检索/);
  assert.equal(calls.length, 2);
  assert.deepEqual(drafts.map((draft) => draft.fullText), ['Inspecting the paper.', 'Final answer.']);
  assert.deepEqual(drafts.map((draft) => draft.turn), [1, 2]);
});

test('a resumed run distinguishes its own retrieval from historical context', async () => {
  const { runConversationalLibraryAgent } = await loadRunner(`
    return { content:'Continued answer.', finishReason:'stop' };
  `);
  const result = await runConversationalLibraryAgent({
    papers: [paper], instruction: 'Continue.', preset,
    loopResumeMessages: [{ role: 'tool', toolCallId: 'old-search', content: '{"result":"previous evidence"}' }],
  });
  assert.match(result.ragNotice, /本次运行未执行本地 RAG 检索/);
  assert.match(result.ragNotice, /历史上下文可能包含此前的检索结果/);
});

test('paper context fallback does not claim a successful RAG retrieval', async () => {
  const { runConversationalLibraryAgent, calls } = await loadRunner(`
    if (calls.length === 1) return { content:'', toolCalls:[{id:'context',name:'request_paper_context',arguments:{mode:'pdf-text',reason:'Read',paperIds:['paper-a']}}], finishReason:'tool_calls' };
    return { content:'Answer.', finishReason:'stop' };
  `);
  const result = await runConversationalLibraryAgent({ papers: [paper], instruction: 'Read', preset });
  assert.match(result.ragNotice, /文献「Rotor」未取得本地 RAG 证据/);
  assert.doesNotMatch(result.ragNotice, /上下文检索返回/);
});

test('the actual service resets answer and thinking aggregation for a retry in the same turn', async () => {
  const { runConversationalLibraryAgent, calls } = await loadRunner(`
    if (calls.length === 1) {
      request.onAnswerDelta?.('Discarded answer.');
      request.onThinkingDelta?.('Discarded thinking.');
      throw new Error('maximum context length exceeded');
    }
    return { content:'Successful answer.', thinking:'Successful thinking.', finishReason:'stop' };
  `);
  const answers: string[] = [];
  const thinking: string[] = [];
  const starts: number[] = [];
  const result = await runConversationalLibraryAgent({ papers: [paper], instruction: 'Answer the question.', preset,
    streamHandlers: {
      onDelta: (_text: string, fullText: string) => answers.push(fullText),
      onThinkingDelta: (_text: string, fullText: string) => thinking.push(fullText),
      onLoopEvent: (event: { kind: string; turn: number }) => { if (event.kind === 'turn_start') starts.push(event.turn); },
    } });
  assert.equal(result.answer, 'Successful answer.');
  assert.equal(calls.length, 2);
  assert.deepEqual(starts, [1, 1]);
  assert.deepEqual(answers, ['Discarded answer.', 'Successful answer.']);
  assert.deepEqual(thinking, ['Discarded thinking.', 'Successful thinking.']);
});

test('the actual Agent reports RAG channels and keyword failures to the model and user', async () => {
  const { runConversationalLibraryAgent, calls } = await loadRunner(`
    if (calls.length % 2 === 1) return { content:'', toolCalls:[{id:'rag',name:'rag_search',arguments:{query:'rotor'}}], finishReason:'tool_calls' };
    return { content:'Answer.', finishReason:'stop' };
  `);
  const previousWindow = (globalThis as any).window;
  let ftsStatus = 'failed';
  let results: unknown[] = [{ documentKey: 'paper-a', chunkId: 'chunk-1', sourceType: 'pdf-text', pageIndex: 0, text: 'Rotor evidence.' }];
  const requests: Array<{ command: string; args: any }> = [];
  (globalThis as any).window = {
    localStorage: { getItem: (key: string) => key === 'paper-reader-secrets-v1' ? JSON.stringify({ embeddingApiKey: 'fixture' }) : null },
    paperquay: { invoke: async (command: string, args: any) => {
      requests.push({ command, args });
      if (command === 'rag_embed_text') return [1, 0];
      if (command === 'rag_retrieve_document_chunks') return { results, ftsStatus, ftsHitCount: 0, indexCoverage: { total: 1, ready: 1, excluded: 0, unavailable: 0 } };
      throw new Error(`Unexpected bridge command: ${command}`);
    } },
  };
  try {
    const first = await runConversationalLibraryAgent({ papers: [paper], instruction: 'Compare', preset });
    const retrievalRequest = requests.find((request) => request.command === 'rag_retrieve_document_chunks');
    assert.equal(retrievalRequest?.args.request.includeDiagnostics, true);
    assert.equal(retrievalRequest?.args.request.includeIndexCoverage, true);
    const firstTool = JSON.parse(JSON.parse(calls[1].messages.find((message: any) => message.toolCallId === 'rag').content).result);
    assert.equal(firstTool.ftsStatus, 'failed', JSON.stringify(firstTool));
    assert.equal(firstTool.retrievalMode, 'vector');
    assert.match(firstTool.ragErrors[0], /关键词检索失败/);
    assert.match(first.ragNotice, /范围 1 篇，返回 1 条证据；关键词检索失败/);
    assert.deepEqual(firstTool.indexCoverage, { total: 1, ready: 1, excluded: 0, unavailable: 0 });
    assert.match(first.ragNotice, /当前模型和维度可用索引 1\/1 篇，排除 0 篇，未就绪或不匹配 0 篇/);

    ftsStatus = 'searched';
    results = [];
    const second = await runConversationalLibraryAgent({ papers: [paper], instruction: 'Compare', preset });
    const secondTool = JSON.parse(JSON.parse(calls[3].messages.find((message: any) => message.toolCallId === 'rag').content).result);
    assert.equal(secondTool.retrievalMode, 'hybrid');
    assert.equal(secondTool.ftsHitCount, 0);
    assert.deepEqual(secondTool.ragErrors, []);
    assert.match(second.ragNotice, /返回 0 条证据；关键词候选 0 条/);
  } finally {
    (globalThis as any).window = previousWindow;
  }
});
