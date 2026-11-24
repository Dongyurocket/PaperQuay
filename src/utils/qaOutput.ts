function findFirstAnswerMarker(text: string): number {
  const marker = text.match(
    /```+[ \t]*(?:html\b|<(?:div|section|article|main|aside|figure|details|svg|table|ul|ol|p|h[1-6])(?=[\s>/]|(?:style|id|role|aria-|data-|class|width|height|viewBox)=))|<(?:div|section|article|main|aside|figure|details|svg|table|ul|ol|p|h[1-6])(?=[\s>/]|(?:style|id|role|aria-|data-|class|width|height|viewBox)=)|#{2,6}\s*/i,
  );

  return marker?.index ?? -1;
}

function containsReasoningLeak(text: string): boolean {
  return /\b(?:considering|thinking|reasoning|analysis|i need to|i should|i will|i'll|we need to|we should|let's|the user|it seems|looks like|likely|ensure to|need to provide|need answer|craft the answer)\b/i.test(
    text,
  );
}

function stripThinkContent(text: string): string {
  const result = String(text ?? '').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
  const openThink = result.match(/<think\b[^>]*>/i);

  if (!openThink || openThink.index === undefined) {
    return result;
  }

  const beforeThink = result.slice(0, openThink.index).trim();
  const afterThink = result.slice(openThink.index + openThink[0].length).trim();
  const markerIndex = findFirstAnswerMarker(afterThink);

  if (markerIndex >= 0) {
    return [beforeThink, afterThink.slice(markerIndex).trim()].filter(Boolean).join('\n\n').trim();
  }

  return beforeThink;
}

function stripReasoningLeak(text: string): string {
  let result = stripThinkContent(text)
    .replace(/<\/?(?:analysis|reasoning|thought|scratchpad)\b[^>]*>/gi, '')
    .trim();
  const markerIndex = findFirstAnswerMarker(result);

  if (markerIndex > 0 && containsReasoningLeak(result.slice(0, markerIndex))) {
    result = result.slice(markerIndex).trimStart();
  }

  const lines = result.split(/\r?\n/);
  let dropCount = 0;

  while (
    dropCount < lines.length - 1 &&
    /^\s*(?:considering|thinking|reasoning|analysis|i need to|i should|i will|i'll|we need to|we should|let's|the user|it seems|looks like|likely|need to provide|need answer|craft the answer)\b/i.test(
      lines[dropCount],
    )
  ) {
    dropCount += 1;
  }

  result = dropCount > 0 ? lines.slice(dropCount).join('\n').trimStart() : result;

  return result.replace(/^\s*(?:final answer|answer|assistant)\s*[:：]\s*/i, '').trim();
}

export function cleanQaAssistantOutput(text: string): string {
  return stripReasoningLeak(text)
    .replace(/<\/?think\b[^>]*>/gi, '')
    .trim();
}
