import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  DocumentChatAttachment,
  DocumentChatRenderMode,
  DocumentChatSession,
  ModelReasoningEffort,
} from '../types/reader.ts';

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

/**
 * QA state is sharded by reader tab. Every reader tab stays mounted while hidden,
 * so a single shared slice would leak drafts and in-flight answers across tabs.
 */
export interface ReaderQaTabState {
  /** Document whose history this slice was restored for; '' before the first restore. */
  workspaceId: string;
  qaSessions: DocumentChatSession[];
  selectedQaSessionId: string;
  qaInput: string;
  qaAttachments: DocumentChatAttachment[];
  selectedQaPresetId: string;
  qaRagEnabled: boolean;
  qaAnswerRenderMode: DocumentChatRenderMode;
  qaReasoningEffort: ModelReasoningEffort;
  qaRunningSessionIds: string[];
  qaError: string;
}

export interface ReaderQaTabActions {
  setWorkspaceId: StateSetter<string>;
  setQaSessions: StateSetter<DocumentChatSession[]>;
  setSelectedQaSessionId: StateSetter<string>;
  setQaInput: StateSetter<string>;
  setQaAttachments: StateSetter<DocumentChatAttachment[]>;
  setSelectedQaPresetId: StateSetter<string>;
  setQaRagEnabled: StateSetter<boolean>;
  setQaAnswerRenderMode: StateSetter<DocumentChatRenderMode>;
  setQaReasoningEffort: StateSetter<ModelReasoningEffort>;
  setQaRunningSessionIds: StateSetter<string[]>;
  setQaError: StateSetter<string>;
}

export type ReaderQaTab = ReaderQaTabState & ReaderQaTabActions;

function createDefaultTabState(): ReaderQaTabState {
  return {
    workspaceId: '',
    qaSessions: [],
    selectedQaSessionId: '',
    qaInput: '',
    qaAttachments: [],
    selectedQaPresetId: '',
    qaRagEnabled: true,
    qaAnswerRenderMode: 'markdown',
    qaReasoningEffort: 'auto',
    qaRunningSessionIds: [],
    qaError: '',
  };
}

const DEFAULT_TAB_STATE = createDefaultTabState();

function resolveStateValue<T>(value: T | ((current: T) => T), current: T): T {
  return typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value;
}

interface ReaderQaStoreState {
  tabs: Record<string, ReaderQaTabState>;
  setTabField: <K extends keyof ReaderQaTabState>(
    tabId: string,
    field: K,
    value: ReaderQaTabState[K] | ((current: ReaderQaTabState[K]) => ReaderQaTabState[K]),
  ) => void;
  removeTab: (tabId: string) => void;
}

export const useReaderQaStore = create<ReaderQaStoreState>()((set) => ({
  tabs: {},
  setTabField: (tabId, field, value) => set((state) => {
    const current = state.tabs[tabId] ?? createDefaultTabState();
    const nextValue = resolveStateValue(value, current[field]);
    if (state.tabs[tabId] && Object.is(nextValue, current[field])) return state;
    const nextTab = { ...current } as ReaderQaTabState;
    (nextTab as Record<keyof ReaderQaTabState, ReaderQaTabState[keyof ReaderQaTabState]>)[field] = nextValue;
    return { tabs: { ...state.tabs, [tabId]: nextTab } };
  }),
  removeTab: (tabId) => set((state) => {
    if (!Object.prototype.hasOwnProperty.call(state.tabs, tabId)) return state;
    const tabs = { ...state.tabs };
    delete tabs[tabId];
    return { tabs };
  }),
}));

export function createReaderQaTabActions(tabId: string): ReaderQaTabActions {
  const setField = useReaderQaStore.getState().setTabField;
  return {
    setWorkspaceId: (value) => setField(tabId, 'workspaceId', value),
    setQaSessions: (value) => setField(tabId, 'qaSessions', value),
    setSelectedQaSessionId: (value) => setField(tabId, 'selectedQaSessionId', value),
    setQaInput: (value) => setField(tabId, 'qaInput', value),
    setQaAttachments: (value) => setField(tabId, 'qaAttachments', value),
    setSelectedQaPresetId: (value) => setField(tabId, 'selectedQaPresetId', value),
    setQaRagEnabled: (value) => setField(tabId, 'qaRagEnabled', value),
    setQaAnswerRenderMode: (value) => setField(tabId, 'qaAnswerRenderMode', value),
    setQaReasoningEffort: (value) => setField(tabId, 'qaReasoningEffort', value),
    setQaRunningSessionIds: (value) => setField(tabId, 'qaRunningSessionIds', value),
    setQaError: (value) => setField(tabId, 'qaError', value),
  };
}

/** Reads a tab slice without subscribing; used to survive tab remounts. */
export function getReaderQaTabSnapshot(tabId: string): ReaderQaTabState | undefined {
  return useReaderQaStore.getState().tabs[tabId];
}

/** Returns this tab's QA slice plus setters bound to the same tab. */
export function useReaderQaTab(tabId: string): ReaderQaTab {
  const tab = useReaderQaStore((state) => state.tabs[tabId]);
  const actions = useMemo(() => createReaderQaTabActions(tabId), [tabId]);
  return { ...(tab ?? DEFAULT_TAB_STATE), ...actions };
}

const qaAbortControllersByTab = new Map<string, Map<string, AbortController>>();

/**
 * Abort controllers live outside the component so an answer that outlives a
 * hidden (unmounted) reader tab can still be stopped from that tab later.
 */
export function getReaderQaAbortControllers(tabId: string): Map<string, AbortController> {
  let controllers = qaAbortControllersByTab.get(tabId);
  if (!controllers) {
    controllers = new Map<string, AbortController>();
    qaAbortControllersByTab.set(tabId, controllers);
  }
  return controllers;
}

/** Drops a closed tab's slice and aborts only that tab's in-flight answers. */
export function removeReaderQaTab(tabId: string): void {
  const controllers = qaAbortControllersByTab.get(tabId);
  if (controllers) {
    for (const controller of controllers.values()) controller.abort();
    qaAbortControllersByTab.delete(tabId);
  }
  useReaderQaStore.getState().removeTab(tabId);
}
