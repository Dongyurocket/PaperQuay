import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areReaderTabBridgeStatesEqual,
  useReaderBridgeStore,
} from '../src/stores/useReaderBridgeStore.ts';
import type { ReaderTabBridgeState } from '../src/features/reader/documentReaderShared.ts';

function bridge(overrides: Partial<ReaderTabBridgeState> = {}): ReaderTabBridgeState {
  return {
    translating: false,
    translatedCount: 0,
    assistantSidebarProps: {} as ReaderTabBridgeState['assistantSidebarProps'],
    onDetachAssistant: () => undefined,
    onAttachAssistant: () => undefined,
    onTranslate: () => undefined,
    onCancelTranslate: () => undefined,
    onClearTranslations: () => undefined,
    onCloudParse: () => undefined,
    onGenerateSummary: () => undefined,
    ...overrides,
  };
}

function resetStore() {
  useReaderBridgeStore.setState({ readerBridges: {} });
}

test('reader bridge store starts empty and keeps independent tab entries', () => {
  resetStore();
  const first = bridge();
  const second = bridge({ translatedCount: 2 });
  const setBridgeState = useReaderBridgeStore.getState().setBridgeState;

  setBridgeState('reader:a', first);
  setBridgeState('reader:b', second);

  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:a'], first);
  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:b'], second);
});

test('reader bridge store replaces only the targeted tab and removes missing ids safely', () => {
  resetStore();
  const first = bridge();
  const replacement = bridge({ translating: true, translatedCount: 4 });
  const second = bridge({ translatedCount: 2 });
  const setBridgeState = useReaderBridgeStore.getState().setBridgeState;

  setBridgeState('reader:a', first);
  setBridgeState('reader:b', second);
  setBridgeState('reader:a', replacement);
  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:a'], replacement);
  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:b'], second);

  const before = useReaderBridgeStore.getState();
  setBridgeState('reader:missing', null);
  assert.equal(useReaderBridgeStore.getState(), before);
  setBridgeState('reader:a', null);
  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:a'], undefined);
  assert.equal(useReaderBridgeStore.getState().readerBridges['reader:b'], second);
});

test('bridge comparison preserves no-op updates and detects every bridge field', () => {
  const callbacks = {
    detach: () => undefined,
    attach: () => undefined,
    translate: () => undefined,
    cancel: () => undefined,
    clear: () => undefined,
    cloud: () => undefined,
    summary: () => undefined,
  };
  const base = bridge({
    assistantSidebarProps: { activePanel: 'chat' } as ReaderTabBridgeState['assistantSidebarProps'],
    onDetachAssistant: callbacks.detach,
    onAttachAssistant: callbacks.attach,
    onTranslate: callbacks.translate,
    onCancelTranslate: callbacks.cancel,
    onClearTranslations: callbacks.clear,
    onCloudParse: callbacks.cloud,
    onGenerateSummary: callbacks.summary,
  });

  assert.equal(areReaderTabBridgeStatesEqual(base, base), true);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base }), true);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, translating: true }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, translatedCount: 1 }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, assistantSidebarProps: {} }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onDetachAssistant: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onAttachAssistant: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onTranslate: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onCancelTranslate: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onClearTranslations: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onCloudParse: () => undefined }), false);
  assert.equal(areReaderTabBridgeStatesEqual(base, { ...base, onGenerateSummary: () => undefined }), false);
});
