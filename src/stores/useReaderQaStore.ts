import { create } from 'zustand';
import type {
  DocumentChatAttachment,
  DocumentChatRenderMode,
  DocumentChatSession,
  ModelReasoningEffort,
} from '../types/reader.ts';

type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface ReaderQaState {
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

function resolveStateValue<T>(value: T | ((current: T) => T), current: T): T {
  return typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value;
}

export const useReaderQaStore = create<ReaderQaState>()((set) => ({
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
  setQaSessions: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaSessions);
    return Object.is(next, state.qaSessions) ? state : { qaSessions: next };
  }),
  setSelectedQaSessionId: (value) => set((state) => {
    const next = resolveStateValue(value, state.selectedQaSessionId);
    return Object.is(next, state.selectedQaSessionId) ? state : { selectedQaSessionId: next };
  }),
  setQaInput: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaInput);
    return Object.is(next, state.qaInput) ? state : { qaInput: next };
  }),
  setQaAttachments: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaAttachments);
    return Object.is(next, state.qaAttachments) ? state : { qaAttachments: next };
  }),
  setSelectedQaPresetId: (value) => set((state) => {
    const next = resolveStateValue(value, state.selectedQaPresetId);
    return Object.is(next, state.selectedQaPresetId) ? state : { selectedQaPresetId: next };
  }),
  setQaRagEnabled: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaRagEnabled);
    return Object.is(next, state.qaRagEnabled) ? state : { qaRagEnabled: next };
  }),
  setQaAnswerRenderMode: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaAnswerRenderMode);
    return Object.is(next, state.qaAnswerRenderMode) ? state : { qaAnswerRenderMode: next };
  }),
  setQaReasoningEffort: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaReasoningEffort);
    return Object.is(next, state.qaReasoningEffort) ? state : { qaReasoningEffort: next };
  }),
  setQaRunningSessionIds: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaRunningSessionIds);
    return Object.is(next, state.qaRunningSessionIds) ? state : { qaRunningSessionIds: next };
  }),
  setQaError: (value) => set((state) => {
    const next = resolveStateValue(value, state.qaError);
    return Object.is(next, state.qaError) ? state : { qaError: next };
  }),
}));
