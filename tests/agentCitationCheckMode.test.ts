import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('generation resolves locally without provider calls; explicit checks call the provider despite a legacy off preference', async () => {
  const bundle = await build({ stdin: {
    contents: `export {verifyLibraryAgentAnswerCitations} from './src/services/libraryAgent.ts';
      export {calls} from './src/services/agentChat';`, resolveDir: process.cwd(), loader: 'ts',
  }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(import.meta.url) },
    plugins: [{ name: 'fake-citation-provider', setup(builder) {
      builder.onResolve({ filter: /\/agentChat$|^\.\/agentChat$/ }, () => ({ path: 'provider', namespace: 'test-provider' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-provider' }, () => ({ contents: `
        export const calls = [];
        export async function runOpenAiCompatibleAgentChatTurn(request) {
          calls.push(request);
          return {content:'{"verdict":"supported","reason":"Direct support"}',usage:{promptTokens:10,completionTokens:5}};
        }`, loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  // Simulate the old browser preference without touching the user's settings.
  new Function('require', 'module', 'exports', 'localStorage', bundle.outputFiles[0].text)(require, module, module.exports, { getItem: () => 'off' });
  const { verifyLibraryAgentAnswerCitations, calls } = module.exports;
  const citation = { id: 'real', label: '1', paperId: 'paper-a', paperTitle: 'Noise Study', pageIndex: 0,
    previewText: 'Rotor optimization reduces acoustic noise compared with the baseline rotor.' };
  const input = { answer: 'Rotor optimization reduces acoustic noise compared with the baseline rotor. [[cite:real]]',
    citations: [citation], preset: { baseUrl: 'https://example.test', apiKey: 'fixture', model: 'test-model' } };
  const local = await verifyLibraryAgentAnswerCitations(input);
  assert.equal(calls.length, 0);
  assert.equal(local.citationBindings[0].reason, 'source-resolved');
  assert.equal(local.evidenceStats.supported, 0);
  const usage: unknown[] = [];
  const manual = await verifyLibraryAgentAnswerCitations({ ...input, checkContent: true,
    streamHandlers: { onCapabilityUsage: (value: unknown) => usage.push(value) } });
  assert.equal(calls.length, 1);
  assert.equal(manual.citationBindings[0].status, 'verified');
  assert.equal(usage.length, 1);
  assert.equal(calls[0].stream, false);
});
