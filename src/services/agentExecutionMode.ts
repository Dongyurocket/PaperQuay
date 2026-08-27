import type { ReaderSettings } from '../types/reader';

/** The conservative, user-controlled fallback for the one-version P3 transition. */
export function selectLibraryAgentExecutionPath(
  settings: Pick<ReaderSettings, 'agentLegacyMode'> | Partial<ReaderSettings> | null | undefined,
): 'legacy' | 'react' {
  return settings?.agentLegacyMode === true ? 'legacy' : 'react';
}
