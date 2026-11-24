import type { ReactNode } from 'react';

/** 设置界面的本地化函数：zh/en 二选一，保留泛型返回值。 */
export type SettingsLocalizer = <T>(zh: T, en: T) => T;

/** 兼容旧命名；应用级设置与 Reader 设置共用同一签名。 */
export type ReaderPreferencesLocalizer = SettingsLocalizer;

export interface SettingsSectionDescriptor {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
}
