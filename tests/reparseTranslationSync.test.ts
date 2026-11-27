import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import { buildMineruTranslationCachePath } from '../src/utils/mineruCache.ts';
import { createTranslationCacheIdentity } from '../src/features/reader/readerTranslationCache.ts';
import { hashTranslationSourceText } from '../src/features/reader/translationSource.ts';

// 端到端验证：重解析覆盖变化后，已有译文立即失效；按修复文本重译后，
// 新译文和它对应的源文本指纹一起写回缓存。
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent']) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const cacheFiles = new Map<string, string>();
(globalThis as unknown as { __cacheFiles: Map<string, string> }).__cacheFiles = cacheFiles;

const harnessBundle = build({
  stdin: {
    contents: `
      import React from 'react';
      import { useDocumentTranslation } from './src/features/reader/useDocumentTranslation.ts';

      export function Harness({ item, blocks, settings, preset }) {
        const [overrides, setOverrides] = React.useState({});
        const getOverrideMarkdown = React.useCallback(
          (blockId) => overrides[blockId],
          [overrides],
        );
        const blockReparse = React.useMemo(
          () => ({
            overrides,
            storageReady: true,
            storageError: '',
            getOverrideMarkdown,
            saveOverride() {},
          }),
          [getOverrideMarkdown, overrides],
        );
        const api = useDocumentTranslation({
          currentDocument: item,
          flatBlocks: blocks,
          blockReparse,
          libraryOperationRunning: false,
          onOpenPreferences() {},
          selectedExcerpt: null,
          selectionTranslationModelPreset: null,
          settings,
          setError() {},
          setStatusMessage() {},
          translationModelPreset: preset,
          translationSnapshot: null,
          updateLibraryOperation() {},
          lRef: { current: (zh) => zh },
        });

        globalThis.__translationApi = api;
        globalThis.__applyOverride = (text) =>
          setOverrides(text ? { [blocks[0].blockId]: text } : {});
        return null;
      }
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'translation-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /services\/translation(?:\.ts)?$/ }, () => ({
          path: 'translation-fixture',
          namespace: 'fixture',
        }));
        builder.onResolve({ filter: /services\/desktop(?:\.ts)?$/ }, () => ({
          path: 'desktop-fixture',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          if (args.path === 'translation-fixture') {
            return {
              loader: 'js',
              contents: `
                export async function translateBlocksOpenAICompatible(options) {
                  return options.blocks.map((block) => ({
                    blockId: block.blockId,
                    translatedText: '新译文（' + block.text + '）',
                  }));
                }
                export async function translateTextOpenAICompatible() { return '划词译文'; }
              `,
            };
          }

          return {
            loader: 'js',
            contents: `
              const store = () => globalThis.__cacheFiles;
              export async function readLocalTextFileIfExists(path) { return store().get(path) ?? null; }
              export async function readLocalTextFile(path) { return store().get(path) ?? ''; }
              export async function writeLocalTextFile(path, content) { store().set(path, content); }
              export async function deleteLocalTextFile(path) { return store().delete(path); }
              export async function listLocalDirectoryFiles() { return []; }
              export async function getAppDefaultPaths() { return { mineruCacheDir: 'C:/cache' }; }
            `,
          };
        });
      },
    },
  ],
});

async function loadHarness() {
  const bundle = await harnessBundle;
  const source = bundle.outputFiles[0].text;
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports as { Harness: (props: Record<string, unknown>) => unknown };
}

interface TranslationApi {
  blockTranslations: Record<string, string>;
  handleRetranslateBlock: (block: unknown) => Promise<void>;
}

function currentApi(): TranslationApi {
  const api = (globalThis as unknown as { __translationApi?: TranslationApi }).__translationApi;
  assert.ok(api, 'harness did not publish the translation API');
  return api;
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for translation state');
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const item = {
  itemKey: 'paper-1',
  title: 'Paper',
  creators: 'Author',
  year: '2026',
  itemType: 'journalArticle',
  source: 'native-library' as const,
  workspaceId: 'native-library:paper-1',
  groupKey: 'native-library:paper-1',
};
const blocks = [
  {
    blockId: 'page-1-block-1',
    pageIndex: 0,
    blockIndex: 0,
    type: 'text' as const,
    content: 'Original OCR text',
  },
];
const preset = {
  id: 'preset-1',
  label: 'Preset',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'test-key',
  model: 'model-a',
  apiMode: 'chat',
};
const settings = {
  mineruCacheDir: 'C:/cache',
  translationBatchSize: 1,
  translationConcurrency: 1,
  translationRequestsPerMinute: 0,
  translationSourceLanguage: 'English',
  translationTargetLanguage: 'Chinese',
  modelRuntimeConfigs: {},
};

test('applying a reparse override invalidates the old translation and retranslates from the repaired text', async () => {
  cacheFiles.clear();
  const identity = createTranslationCacheIdentity(preset.baseUrl, preset.model, 'English');
  const cachePath = buildMineruTranslationCachePath('C:/cache', item, 'Chinese', identity)!;
  const originalHash = hashTranslationSourceText('Original OCR text');

  // 旧版缓存：没有 sourceHashes，相当于历史译文。
  cacheFiles.set(cachePath, JSON.stringify({
    version: 1,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translatedAt: '2026-11-20T00:00:00.000Z',
    translations: { 'page-1-block-1': '旧译文' },
  }));

  const { Harness } = await loadHarness();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(Harness, { item, blocks, settings, preset }));
  });
  await waitFor(() => currentApi().blockTranslations['page-1-block-1'] === '旧译文');

  // 模拟 AI 重析保存：覆盖变化后旧译文立即失效。
  await act(async () => {
    (globalThis as unknown as { __applyOverride: (text: string | null) => void })
      .__applyOverride('Repaired OCR text');
  });
  await waitFor(() => !currentApi().blockTranslations['page-1-block-1']);

  // 阅读器保存覆盖后触发的自动重译走的是有效源文本。
  await act(async () => {
    await currentApi().handleRetranslateBlock(blocks[0]);
  });
  await waitFor(
    () => currentApi().blockTranslations['page-1-block-1'] === '新译文（Repaired OCR text）',
  );

  const saved = JSON.parse(cacheFiles.get(cachePath) ?? '{}');
  assert.equal(saved.version, 2);
  assert.equal(saved.translations['page-1-block-1'], '新译文（Repaired OCR text）');
  assert.equal(
    saved.sourceHashes['page-1-block-1'],
    hashTranslationSourceText('Repaired OCR text'),
  );
  assert.notEqual(saved.sourceHashes['page-1-block-1'], originalHash);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
