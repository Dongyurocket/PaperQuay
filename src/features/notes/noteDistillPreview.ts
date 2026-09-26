import type { Note, NoteAnchor, UpdateNoteRequest, CreateNoteRequest } from '../../types/notes.ts';
import type { SelectedExcerpt } from '../../types/reader.ts';
import {
  buildDistilledExcerptAppendPatch,
  buildDistilledExcerptNoteCreateRequest,
} from './noteDistill.ts';

export type DistillPreviewPhase = 'editing' | 'processing' | 'ready' | 'cancelled' | 'confirmed';

export interface DistillPreviewState {
  phase: DistillPreviewPhase;
  selectedExcerpt: SelectedExcerpt;
  originalText: string;
  sourceText: string;
  title: string;
  distilledText: string;
  appendTargetId: string | null;
  reidentifyRequested: boolean;
  aiEnhanced: boolean;
  fallbackNotice: string | null;
}

export function createDistillPreviewState(input: {
  selectedExcerpt: SelectedExcerpt;
  appendTarget?: Note | null;
}): DistillPreviewState {
  return {
    phase: 'editing',
    selectedExcerpt: input.selectedExcerpt,
    originalText: input.selectedExcerpt.text,
    sourceText: input.selectedExcerpt.text,
    title: '',
    distilledText: '',
    appendTargetId: input.appendTarget?.id ?? null,
    reidentifyRequested: false,
    aiEnhanced: false,
    fallbackNotice: null,
  };
}

export function markDistillPreviewProcessing(state: DistillPreviewState): DistillPreviewState {
  return { ...state, phase: 'processing', fallbackNotice: null };
}

export function markDistillPreviewReady(
  state: DistillPreviewState,
  result: { title: string; text: string; sourceText?: string; aiEnhanced?: boolean; fallbackNotice?: string | null },
): DistillPreviewState {
  return {
    ...state,
    phase: 'ready',
    title: result.title,
    distilledText: result.text,
    sourceText: result.sourceText?.trim() || state.originalText,
    aiEnhanced: result.aiEnhanced === true,
    fallbackNotice: result.fallbackNotice ?? null,
  };
}

export function cancelDistillPreview(state: DistillPreviewState): DistillPreviewState {
  return { ...state, phase: 'cancelled' };
}

export function confirmDistillPreview(state: DistillPreviewState): DistillPreviewState {
  return { ...state, phase: 'confirmed' };
}

export function buildDistillPreviewCommit(input: {
  state: DistillPreviewState;
  paperId: string;
  sourceTitle?: string;
  appendTarget?: Note | null;
}): { kind: 'create'; request: CreateNoteRequest } | { kind: 'append'; noteId: string; patch: UpdateNoteRequest; anchor: NoteAnchor } | null {
  const { state } = input;
  if (!['ready', 'confirmed'].includes(state.phase) || !state.distilledText.trim()) {
    return null;
  }

  if (input.appendTarget) {
    const result = buildDistilledExcerptAppendPatch({
      note: input.appendTarget,
      paperId: input.paperId,
      selectedExcerpt: state.selectedExcerpt,
      sourceTitle: input.sourceTitle,
      distilledText: state.distilledText,
      sourceText: state.sourceText,
      aiEnhanced: state.aiEnhanced,
    });
    return { kind: 'append', noteId: input.appendTarget.id, ...result };
  }

  return {
    kind: 'create',
    request: buildDistilledExcerptNoteCreateRequest({
      paperId: input.paperId,
      selectedExcerpt: state.selectedExcerpt,
      sourceTitle: input.sourceTitle,
      distilledTitle: state.title,
      distilledText: state.distilledText,
      sourceText: state.sourceText,
      aiEnhanced: state.aiEnhanced,
    }),
  };
}
