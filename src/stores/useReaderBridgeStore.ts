import { create } from 'zustand';
import type { ReaderTabBridgeState } from '../features/reader/documentReaderShared.ts';

export function areReaderTabBridgeStatesEqual(
  left: ReaderTabBridgeState | null | undefined,
  right: ReaderTabBridgeState | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.translating === right.translating &&
    left.translatedCount === right.translatedCount &&
    left.assistantSidebarProps === right.assistantSidebarProps &&
    left.onDetachAssistant === right.onDetachAssistant &&
    left.onAttachAssistant === right.onAttachAssistant &&
    left.onTranslate === right.onTranslate &&
    left.onCancelTranslate === right.onCancelTranslate &&
    left.onClearTranslations === right.onClearTranslations &&
    left.onCloudParse === right.onCloudParse &&
    left.onGenerateSummary === right.onGenerateSummary
  );
}

export interface ReaderBridgeState {
  readerBridges: Record<string, ReaderTabBridgeState>;
  setBridgeState: (tabId: string, bridge: ReaderTabBridgeState | null) => void;
}

export const useReaderBridgeStore = create<ReaderBridgeState>()((set) => ({
  readerBridges: {},
  setBridgeState: (tabId, bridge) => {
    set((state) => {
      if (!bridge) {
        if (!(tabId in state.readerBridges)) {
          return state;
        }

        const next = { ...state.readerBridges };
        delete next[tabId];
        return { readerBridges: next };
      }

      if (areReaderTabBridgeStatesEqual(state.readerBridges[tabId], bridge)) {
        return state;
      }

      return {
        readerBridges: {
          ...state.readerBridges,
          [tabId]: bridge,
        },
      };
    });
  },
}));
