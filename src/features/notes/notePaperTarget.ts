/** Normalize persisted note targets, including ids from the removed welcome example. */
export function normalizeNotePaperTarget(rawTarget: string): string {
  const value = rawTarget.trim();
  if (!value) return '';

  // Notes may still store this prefix in notes.sqlite, so keep it readable for old data.
  if (
    value.startsWith('native-library:') ||
    value.startsWith('standalone:') ||
    value.startsWith('onboarding:')
  ) {
    return value;
  }

  return `native-library:${value}`;
}
