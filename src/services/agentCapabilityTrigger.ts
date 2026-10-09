export function isComparativeSurveyInstruction(instruction: string, paperCount: number): boolean {
  if (paperCount < 2) {
    return false;
  }

  const normalized = instruction.toLocaleLowerCase();
  const surveySignals = [
    '对比调研',
    '比较调研',
    '对比综述',
    '比较综述',
    'comparative survey',
    'comparative review',
    'comparison report',
    '完整综述',
    '完整调研',
    '完整版综述',
    '完整版调研',
    '全面综述',
    '系统综述',
    'comprehensive review',
    'comprehensive survey',
    'full literature review',
    'full survey',
    'complete survey',
    'systematic review',
  ];

  if (surveySignals.some((signal) => normalized.includes(signal))) return true;

  // A request to examine the body of every candidate requires the survey
  // pipeline and its coverage ledger. Candidate count alone never routes it.
  const allCandidates = /全查|逐篇|全部|所有|每篇|全库|each\s+paper|every\s+paper|all\s+(?:papers|documents)/i.test(normalized);
  const bodyInspection = /查(?:全文|正文|切片)|(?:检索|检查|阅读|调研).{0,12}(?:全文|正文|切片)|(?:全文|正文|切片).{0,12}(?:检索|检查|阅读|调研)|full[- ]text.{0,15}(?:search|check|inspect|read)|(?:search|check|inspect|read).{0,15}full[- ]text/i.test(normalized);
  return allCandidates && bodyInspection;
}
