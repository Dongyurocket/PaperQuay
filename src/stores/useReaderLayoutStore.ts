import { create } from 'zustand';
import type { AssistantPanelKey } from '../types/reader';
import {
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  MAX_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  loadStoredNumber,
} from '../features/reader/readerWorkspaceShared.ts';

export const DEFAULT_ASSISTANT_PANEL_WIDTH = 408;

export function clampReaderAssistantPanelWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ASSISTANT_PANEL_WIDTH;
  }

  return Math.round(
    Math.min(MAX_ASSISTANT_PANEL_WIDTH, Math.max(MIN_ASSISTANT_PANEL_WIDTH, value)),
  );
}

export function readStoredReaderAssistantPanelWidth(): number {
  return clampReaderAssistantPanelWidth(
    loadStoredNumber(ASSISTANT_PANEL_WIDTH_STORAGE_KEY, DEFAULT_ASSISTANT_PANEL_WIDTH),
  );
}

function writeAssistantPanelWidth(width: number) {
  try {
    localStorage.setItem(ASSISTANT_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Ignore unavailable storage.
  }
}

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface ReaderLayoutState {
  assistantActivePanel: AssistantPanelKey;
  assistantDetached: boolean;
  assistantPanelWidth: number;
  assistantPanelResizing: boolean;
  setAssistantActivePanel: StateSetter<AssistantPanelKey>;
  setAssistantDetached: StateSetter<boolean>;
  setAssistantPanelWidth: StateSetter<number>;
  setAssistantPanelResizing: StateSetter<boolean>;
  persistAssistantPanelWidth: () => void;
}

function resolveStateValue<T>(value: T | ((current: T) => T), current: T): T {
  return typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value;
}

export const useReaderLayoutStore = create<ReaderLayoutState>()((set, get) => ({
  assistantActivePanel: 'chat',
  assistantDetached: false,
  assistantPanelWidth: readStoredReaderAssistantPanelWidth(),
  assistantPanelResizing: false,
  setAssistantActivePanel: (value) =>
    set((state) => {
      const next = resolveStateValue(value, state.assistantActivePanel);
      return Object.is(next, state.assistantActivePanel) ? state : { assistantActivePanel: next };
    }),
  setAssistantDetached: (value) =>
    set((state) => {
      const next = resolveStateValue(value, state.assistantDetached);
      return Object.is(next, state.assistantDetached) ? state : { assistantDetached: next };
    }),
  setAssistantPanelWidth: (value) =>
    set((state) => {
      const next = clampReaderAssistantPanelWidth(
        resolveStateValue(value, state.assistantPanelWidth),
      );
      return Object.is(next, state.assistantPanelWidth) ? state : { assistantPanelWidth: next };
    }),
  setAssistantPanelResizing: (value) =>
    set((state) => {
      const next = resolveStateValue(value, state.assistantPanelResizing);
      return Object.is(next, state.assistantPanelResizing) ? state : { assistantPanelResizing: next };
    }),
  persistAssistantPanelWidth: () => {
    writeAssistantPanelWidth(get().assistantPanelWidth);
  },
}));
