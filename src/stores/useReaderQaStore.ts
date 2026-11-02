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
  setQaSessions: (value) => set((state) => ({ qaSessions: resolveStateValue(value, state.qaSessions) })),
  setSelectedQaSessionId: (value) =>
    set((state) => ({ selectedQaSessionId: resolveStateValue(value, state.selectedQaSessionId) })),
  setQaInput: (value) => set((state) => ({ qaInput: resolveStateValue(value, state.qaInput) })),
  setQaAttachments: (value) =>
    set((state) => ({ qaAttachments: resolveStateValue(value, state.qaAttachments) })),
  setSelectedQaPresetId: (value) =>
    set((state) => ({ selectedQaPresetId: resolveStateValue(value, state.selectedQaPresetId) })),
  setQaRagEnabled: (value) =>
    set((state) => ({ qaRagEnabled: resolveStateValue(value, state.qaRagEnabled) })),
  setQaAnswerRenderMode: (value) =>
    set((state) => ({ qaAnswerRenderMode: resolveStateValue(value, state.qaAnswerRenderMode) })),
  setQaReasoningEffort: (value) =>
    set((state) => ({ qaReasoningEffort: resolveStateValue(value, state.qaReasoningEffort) })),
  setQaRunningSessionIds: (value) =>
    set((state) => ({ qaRunningSessionIds: resolveStateValue(value, state.qaRunningSessionIds) })),
  setQaError: (value) => set((state) => ({ qaError: resolveStateValue(value, state.qaError) })),
}));
