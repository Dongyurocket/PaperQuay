export interface CopyTextOptions {
  preserveWhitespace?: boolean;
}

async function copyWithTextarea(text: string): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    return false;
  }

  const activeElement = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const inputSelection =
    activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
      ? {
          start: activeElement.selectionStart ?? 0,
          end: activeElement.selectionEnd ?? 0,
          direction: activeElement.selectionDirection ?? 'none',
        }
      : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    return document.execCommand('copy');
  } finally {
    textarea.remove();
    if (activeElement?.isConnected) {
      activeElement.focus();
      if (
        inputSelection &&
        (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)
      ) {
        activeElement.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
      }
    }
    if (
      !inputSelection &&
      selection &&
      range &&
      range.startContainer.isConnected &&
      range.endContainer.isConnected
    ) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

export async function copyTextToClipboard(
  value: string,
  options: CopyTextOptions = {},
): Promise<boolean> {
  const text = options.preserveWhitespace ? value : value.trim();
  if (!text.trim()) return false;

  const win = typeof window === 'undefined' ? undefined : window;
  const attempts: Array<() => void | Promise<void>> = [];
  const electronWrite = win?.paperquay?.clipboard?.writeText;
  if (electronWrite) {
    attempts.push(() => electronWrite.call(win?.paperquay?.clipboard, text));
  }

  const browserWrite = typeof navigator === 'undefined' ? undefined : navigator.clipboard?.writeText;
  if (browserWrite) {
    attempts.push(() => browserWrite.call(navigator.clipboard, text));
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    if (await copyWithTextarea(text)) return true;
  } catch (error) {
    lastError = error;
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('Clipboard write failed');
}
