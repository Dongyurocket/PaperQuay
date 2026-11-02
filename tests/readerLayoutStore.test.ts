import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  clampReaderAssistantPanelWidth,
  readStoredReaderAssistantPanelWidth,
  useReaderLayoutStore,
} from '../src/stores/useReaderLayoutStore.ts';
import {
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
} from '../src/features/reader/readerWorkspaceShared.ts';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test('reader layout store exposes the original defaults', () => {
  useReaderLayoutStore.setState({
    assistantActivePanel: 'chat',
    assistantDetached: false,
    assistantPanelWidth: DEFAULT_ASSISTANT_PANEL_WIDTH,
    assistantPanelResizing: false,
  });

  const state = useReaderLayoutStore.getState();
  assert.equal(state.assistantActivePanel, 'chat');
  assert.equal(state.assistantDetached, false);
  assert.equal(state.assistantPanelWidth, 408);
  assert.equal(state.assistantPanelResizing, false);
});

test('reader layout setters support direct and updater values', () => {
  const state = useReaderLayoutStore.getState();
  state.setAssistantActivePanel('notes');
  state.setAssistantDetached(true);
  state.setAssistantPanelResizing(true);
  state.setAssistantActivePanel((current) => current === 'notes' ? 'chat' : 'notes');
  state.setAssistantDetached((current) => !current);
  state.setAssistantPanelResizing((current) => !current);

  const next = useReaderLayoutStore.getState();
  assert.equal(next.assistantActivePanel, 'chat');
  assert.equal(next.assistantDetached, false);
  assert.equal(next.assistantPanelResizing, false);
});

test('reader assistant panel width clamps to the original boundaries', () => {
  assert.equal(clampReaderAssistantPanelWidth(MIN_ASSISTANT_PANEL_WIDTH - 1), MIN_ASSISTANT_PANEL_WIDTH);
  assert.equal(clampReaderAssistantPanelWidth(MAX_ASSISTANT_PANEL_WIDTH + 1), MAX_ASSISTANT_PANEL_WIDTH);
  assert.equal(clampReaderAssistantPanelWidth(407.6), 408);
  assert.equal(clampReaderAssistantPanelWidth(Number.NaN), DEFAULT_ASSISTANT_PANEL_WIDTH);

  useReaderLayoutStore.getState().setAssistantPanelWidth(MIN_ASSISTANT_PANEL_WIDTH - 100);
  assert.equal(useReaderLayoutStore.getState().assistantPanelWidth, MIN_ASSISTANT_PANEL_WIDTH);
  useReaderLayoutStore.getState().setAssistantPanelWidth(MAX_ASSISTANT_PANEL_WIDTH + 100);
  assert.equal(useReaderLayoutStore.getState().assistantPanelWidth, MAX_ASSISTANT_PANEL_WIDTH);
});

test('reader assistant panel width reads and writes the original storage key', () => {
  const storage = createStorage({ [ASSISTANT_PANEL_WIDTH_STORAGE_KEY]: '512' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  assert.equal(readStoredReaderAssistantPanelWidth(), 512);
  useReaderLayoutStore.getState().setAssistantPanelWidth(640);
  useReaderLayoutStore.getState().persistAssistantPanelWidth();
  assert.equal(storage.getItem(ASSISTANT_PANEL_WIDTH_STORAGE_KEY), '640');

  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('reader layout store falls back when persisted width is malformed', () => {
  const storage = createStorage({ [ASSISTANT_PANEL_WIDTH_STORAGE_KEY]: 'not-a-number' });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  assert.equal(readStoredReaderAssistantPanelWidth(), DEFAULT_ASSISTANT_PANEL_WIDTH);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('reader layout store rounds updater widths before persistence', () => {
  useReaderLayoutStore.getState().setAssistantPanelWidth(321.6);
  assert.equal(useReaderLayoutStore.getState().assistantPanelWidth, 322);
  useReaderLayoutStore.getState().setAssistantPanelWidth((current) => current + 0.4);
  assert.equal(useReaderLayoutStore.getState().assistantPanelWidth, 322);
});

test('reader layout store keeps unrelated fields when changing panel width', () => {
  useReaderLayoutStore.setState({ assistantActivePanel: 'notes', assistantDetached: true, assistantPanelResizing: true });
  useReaderLayoutStore.getState().setAssistantPanelWidth(500);
  const state = useReaderLayoutStore.getState();
  assert.equal(state.assistantActivePanel, 'notes');
  assert.equal(state.assistantDetached, true);
  assert.equal(state.assistantPanelResizing, true);
});
