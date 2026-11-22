export interface StrippedRagQuery {
  question: string;
  excerpt: string;
  combined: string;
}

export function stripRagQueryTemplateNoise(rawQuery: string): StrippedRagQuery;
export function extractFormulaNumbers(
  text: string,
  options?: { includeStandaloneParens?: boolean },
): string[];
export function extractReferenceNumbers(text: string): string[];
export function hasSourceOriginIntent(text: string): boolean;
export function extractShortSymbolTokens(text: string): string[];
export function buildFtsMatchQuery(value: string): string;
export function compactMathSpaces(text: string): string;
export function chunkMatchesFormulaNumber(text: string, rawNum: string): boolean;
export function chunkMatchesReferenceEntry(text: string, rawNum: string): boolean;
export function scoreChunkByExactQuerySignals(chunkText: string, rawQuery: string): number;
