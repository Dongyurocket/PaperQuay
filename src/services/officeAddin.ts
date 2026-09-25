import { invoke } from '../platform/electron/core';
import type { OfficeAddinSettings, OfficeAddinSourceSettings } from '../types/library';

/**
 * Word 加载项（Office 桥）渲染层封装。
 *
 * 桥跑在 Electron 主进程，暴露 http://127.0.0.1:<port>；加载项页面由主进程的源站托管
 * （https://localhost:3000，证书不可用时回退 http://localhost:3007）。
 * 这里只封装生命周期与状态查询，「复制连接信息」用的端口/令牌来自 office_get_status。
 */

export const DEFAULT_OFFICE_ADDIN_SOURCE_SETTINGS: OfficeAddinSourceSettings = {
  enabled: true,
  httpsPort: 3000,
  httpPort: 3007,
  allowHttpFallback: true,
};

export const DEFAULT_OFFICE_ADDIN_SETTINGS: OfficeAddinSettings = {
  enabled: true,
  port: 23120,
  allowedOrigins: [],
  allowWriteBack: true,
  source: DEFAULT_OFFICE_ADDIN_SOURCE_SETTINGS,
};

export interface OfficeAddinInstallInfo {
  installDir: string;
  infoPath: string;
  manifestPath: string;
  origin: string | null;
  scheme: string | null;
  port: number;
  installedAt: string | null;
  version: string | null;
  certThumbprint: string | null;
  trusted: boolean;
}

export interface OfficeAddinSourceStatus {
  enabled: boolean;
  running: boolean;
  scheme: 'https' | 'http' | null;
  port: number | null;
  origin: string | null;
  url: string | null;
  root: string | null;
  installDir: string;
  manifestPath: string | null;
  installed: OfficeAddinInstallInfo | null;
  certificate: {
    available: boolean;
    source: string | null;
    dir: string | null;
    pfxPath: string | null;
    cerPath: string | null;
    reason: string;
  };
  settings: OfficeAddinSourceSettings;
  /** 最近一次 Word 加载项经同源 /api/v1 访问的记录（设置页显示「Word 已连接」）。 */
  lastClient?: { method: string; path: string; client: string; at: string } | null;
  /** 运行中但有降级时（例如 HTTPS 启动失败回退 HTTP）的原因。 */
  note?: string;
  error?: string;
}

export interface OfficeBridgeStatus {
  running: boolean;
  enabled: boolean;
  port: number | null;
  token: string | null;
  url: string | null;
  apiVersion: number;
  appVersion: string;
  startedAt: string | null;
  discoveryPath: string | null;
  allowedOrigins: string[];
  allowWriteBack: boolean;
  settings: OfficeAddinSettings;
  /** 加载项页面源站状态（旧版本主进程可能不返回）。 */
  source?: OfficeAddinSourceStatus | null;
  /** 启动/重启失败时的原因（命令本身不抛错，状态里带回）。 */
  error?: string;
}

export interface PaperCitationRecord {
  paperId: string;
  documentId: string;
  documentTitle: string | null;
  citedAt: number;
  source: string;
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

/** 规范化源站设置（主进程缺字段时补默认值）。 */
export function normalizeOfficeAddinSourceSettings(
  source: OfficeAddinSourceSettings | null | undefined,
): OfficeAddinSourceSettings {
  const defaults = DEFAULT_OFFICE_ADDIN_SOURCE_SETTINGS;
  const port = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : fallback;
  };
  return {
    enabled: source?.enabled ?? defaults.enabled,
    httpsPort: port(source?.httpsPort, defaults.httpsPort),
    httpPort: port(source?.httpPort, defaults.httpPort),
    allowHttpFallback: source?.allowHttpFallback ?? defaults.allowHttpFallback,
  };
}

/** 规范化主进程可能缺字段的状态（升级过程中的兼容处理）。 */
function normalizeStatus(status: OfficeBridgeStatus | null): OfficeBridgeStatus {
  const settings = status?.settings ?? DEFAULT_OFFICE_ADDIN_SETTINGS;
  return {
    running: Boolean(status?.running),
    enabled: status?.enabled ?? settings.enabled,
    port: status?.port ?? null,
    token: status?.token ?? null,
    url: status?.url ?? null,
    apiVersion: status?.apiVersion ?? 1,
    appVersion: status?.appVersion ?? '',
    startedAt: status?.startedAt ?? null,
    discoveryPath: status?.discoveryPath ?? null,
    allowedOrigins: status?.allowedOrigins ?? settings.allowedOrigins ?? [],
    allowWriteBack: status?.allowWriteBack ?? settings.allowWriteBack,
    settings: {
      enabled: settings.enabled ?? DEFAULT_OFFICE_ADDIN_SETTINGS.enabled,
      port: settings.port ?? DEFAULT_OFFICE_ADDIN_SETTINGS.port,
      allowedOrigins: settings.allowedOrigins ?? [],
      allowWriteBack: settings.allowWriteBack ?? DEFAULT_OFFICE_ADDIN_SETTINGS.allowWriteBack,
      source: normalizeOfficeAddinSourceSettings(settings.source),
    },
    source: status?.source ? { ...status.source, settings: normalizeOfficeAddinSourceSettings(status.source.settings) } : null,
    ...(status?.error ? { error: status.error } : {}),
  };
}

export async function getOfficeAddinStatus(): Promise<OfficeBridgeStatus> {
  try {
    return normalizeStatus(await invoke<OfficeBridgeStatus>('office_get_status'));
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取 Office 插件状态失败'));
  }
}

export async function startOfficeBridge(): Promise<OfficeBridgeStatus> {
  try {
    return normalizeStatus(await invoke<OfficeBridgeStatus>('office_start_bridge'));
  } catch (error) {
    throw new Error(toErrorMessage(error, '启动 Office 桥失败'));
  }
}

export async function stopOfficeBridge(): Promise<OfficeBridgeStatus> {
  try {
    return normalizeStatus(await invoke<OfficeBridgeStatus>('office_stop_bridge'));
  } catch (error) {
    throw new Error(toErrorMessage(error, '停止 Office 桥失败'));
  }
}

export async function restartOfficeBridge(): Promise<OfficeBridgeStatus> {
  try {
    return normalizeStatus(await invoke<OfficeBridgeStatus>('office_restart_bridge'));
  } catch (error) {
    throw new Error(toErrorMessage(error, '重启 Office 桥失败'));
  }
}

export async function listPaperCitations(paperId: string): Promise<PaperCitationRecord[]> {
  try {
    const result = await invoke<{ citations: PaperCitationRecord[] }>('office_list_citations', { paperId });
    return result?.citations ?? [];
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取引用记录失败'));
  }
}

export async function revealOfficeDiscoveryFile(): Promise<void> {
  try {
    await invoke('office_reveal_discovery_file');
  } catch (error) {
    throw new Error(toErrorMessage(error, '打开桥发现文件失败'));
  }
}

export interface OfficeAddinTrustResult {
  ok: boolean;
  reason?: string;
  cerPath?: string;
  dir?: string;
  source?: OfficeAddinSourceStatus | null;
}

/** 把源站自签证书装进当前用户的受信任根（Word 不再报证书错误）。 */
export async function trustOfficeAddinCertificate(): Promise<OfficeAddinTrustResult> {
  try {
    return await invoke<OfficeAddinTrustResult>('office_trust_addin_certificate');
  } catch (error) {
    return { ok: false, reason: toErrorMessage(error, '信任加载项证书失败') };
  }
}

/** 定位加载项：安装器写入的清单优先，其次 office-addin 源目录。 */
export async function revealOfficeAddinSource(): Promise<void> {
  try {
    await invoke('office_reveal_addin_source');
  } catch (error) {
    throw new Error(toErrorMessage(error, '打开加载项目录失败'));
  }
}

/** 加载项「连接 PaperQuay」时需要粘贴的信息（端口 + 令牌）。 */
export function formatOfficeConnectionInfo(status: OfficeBridgeStatus): string {
  if (!status.running || !status.port || !status.token) return '';
  return `${status.port}:${status.token}`;
}

export function parseOfficeConnectionInfo(input: string): { port: number; token: string } | null {
  const text = input.trim();
  if (!text) return null;
  const separator = text.includes(':') ? ':' : text.includes('@') ? '@' : null;
  if (!separator) return null;
  const [rawPort, ...rest] = text.split(separator);
  const port = Number.parseInt(rawPort.trim(), 10);
  const token = rest.join(separator).trim();
  if (!Number.isFinite(port) || port <= 0 || port > 65535 || !token) return null;
  return { port, token };
}
