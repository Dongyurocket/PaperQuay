import {
  createContext,
  useCallback,
  useContext,
  type PropsWithChildren,
} from 'react';
import type { UiLanguage } from '../types/reader';

export { pickDocumentLocaleText } from './documentLocale';

const AppLocaleContext = createContext<UiLanguage>('zh-CN');

export function AppLocaleProvider({
  value,
  children,
}: PropsWithChildren<{ value: UiLanguage }>) {
  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale() {
  return useContext(AppLocaleContext);
}

export function useLocaleText() {
  const locale = useAppLocale();

  return useCallback(
    <T,>(zh: T, en: T) => (locale === 'en-US' ? en : zh),
    [locale],
  );
}

/**
 * 把界面语言同步到 <html lang>（E5）。
 *
 * index.html 里的 lang="zh-CN" 只是首屏水合前的兜底；切到英文界面后
 * 读屏器、断词与字体选择仍按 zh-CN 处理，所以运行时必须跟着 uiLanguage 更新。
 */
export function applyDocumentLanguage(locale: UiLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}
