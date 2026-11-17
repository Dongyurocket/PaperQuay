import type { AppCommand } from '../../ui/commands';

export const READER_IMMERSIVE_COMMAND_ID = 'reader.toggle-immersive';
export const READER_IMMERSIVE_SHORTCUT = 'mod+shift+f';

export interface ReaderImmersiveVisibility {
  showHeader: boolean;
  showPaneToolbars: boolean;
  showExitControl: boolean;
}

export function getReaderImmersiveVisibility(immersive: boolean): ReaderImmersiveVisibility {
  return {
    showHeader: !immersive,
    showPaneToolbars: !immersive,
    showExitControl: immersive,
  };
}

export function buildReaderImmersiveCommand(options: {
  available: boolean;
  localize: (zh: string, en: string) => string;
  onToggle: () => void;
}): AppCommand {
  return {
    id: READER_IMMERSIVE_COMMAND_ID,
    title: options.localize('切换沉浸模式', 'Toggle immersive mode'),
    group: options.localize('阅读器', 'Reader'),
    shortcut: READER_IMMERSIVE_SHORTCUT,
    isAvailable: () => options.available,
    run: options.onToggle,
  };
}

