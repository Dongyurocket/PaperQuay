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
  assert.equal(calls.length, 2);
  assert.deepEqual(drafts.map((draft) => draft.fullText), ['Inspecting the paper.', 'Final answer.']);
  assert.deepEqual(drafts.map((draft) => draft.turn), [1, 2]);
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
