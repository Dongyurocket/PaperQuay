export interface PresetNumberDraft {
  text: string;
  editing: boolean;
}

export function presetNumberText(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function createPresetNumberDraft(value: number | undefined): PresetNumberDraft {
  return { text: presetNumberText(value), editing: false };
}

export function parsePresetNumberDraft(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type PresetNumberDraftAction =
  | { type: 'change'; text: string }
  | { type: 'sync'; value: number | undefined }
  | { type: 'reset'; value: number | undefined }
  | {
      type: 'commit';
      normalize: (value: number | undefined) => number | undefined;
    };

export interface PresetNumberDraftResult {
  state: PresetNumberDraft;
  didCommit: boolean;
  committed?: number | undefined;
}

export function reducePresetNumberDraft(
  state: PresetNumberDraft,
  action: PresetNumberDraftAction,
): PresetNumberDraftResult {
  switch (action.type) {
    case 'change':
      return {
        state: { text: action.text, editing: true },
        didCommit: false,
      };
    case 'sync':
      if (state.editing) {
        return { state, didCommit: false };
      }
      return { state: createPresetNumberDraft(action.value), didCommit: false };
    case 'reset':
      return { state: createPresetNumberDraft(action.value), didCommit: false };
    case 'commit': {
      const raw = parsePresetNumberDraft(state.text);
      const committed = action.normalize(raw);
      return {
        state: { text: presetNumberText(committed), editing: false },
        didCommit: true,
        committed,
      };
    }
    default:
      return { state, didCommit: false };
  }
}
