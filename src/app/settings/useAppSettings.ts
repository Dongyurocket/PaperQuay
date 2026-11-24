import { useSyncExternalStore } from 'react';

import {
  getAppSettingsSnapshot,
  subscribeAppSettings,
  type NormalizedAppSettingsSnapshot,
} from './appSettingsCache';

export function useAppSettingsSnapshot(): NormalizedAppSettingsSnapshot | null {
  return useSyncExternalStore(
    subscribeAppSettings,
    getAppSettingsSnapshot,
    getAppSettingsSnapshot,
  );
}
