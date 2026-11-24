import { create } from 'zustand';

export type AppSettingsSectionKey = 'general' | 'backup' | 'mcp' | 'updates';

interface AppSettingsState {
  open: boolean;
  section: AppSettingsSectionKey;
  openSettings: (section?: AppSettingsSectionKey) => void;
  closeSettings: () => void;
}

/** 应用级设置窗口的开关由 App 持有，Notes / Graph / Reader 都可触发。 */
export const useAppSettingsStore = create<AppSettingsState>((set) => ({
  open: false,
  section: 'general',
  openSettings: (section = 'general') => set({ open: true, section }),
  closeSettings: () => set({ open: false }),
}));
