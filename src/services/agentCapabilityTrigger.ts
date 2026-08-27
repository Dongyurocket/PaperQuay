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
  ];

  return surveySignals.some((signal) => normalized.includes(signal));
}
