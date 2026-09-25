import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Play, RefreshCw, ShieldCheck, Square } from 'lucide-react';

import { useLocaleText } from '../../../i18n/uiLanguage';
import {
  DEFAULT_OFFICE_ADDIN_SETTINGS,
  formatOfficeConnectionInfo,
  getOfficeAddinStatus,
  normalizeOfficeAddinSourceSettings,
  restartOfficeBridge,
  revealOfficeAddinSource,
  revealOfficeDiscoveryFile,
  startOfficeBridge,
  stopOfficeBridge,
  trustOfficeAddinCertificate,
  type OfficeBridgeStatus,
} from '../../../services/officeAddin';
import type { OfficeAddinSettings, OfficeAddinSourceSettings } from '../../../types/library';

interface OfficeAddinSectionProps {
  settings: OfficeAddinSettings | undefined;
  onChange: (settings: OfficeAddinSettings) => void;
}

async function copyText(text: string): Promise<boolean> {
  if (window.paperquay?.clipboard?.writeText) {
    window.paperquay.clipboard.writeText(text);
    return true;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

/**
 * Word 加载项（Office 桥）设置与状态。桥的生命周期命令走主进程，设置项本身随
 * 文库设置一起保存（library_update_settings 浅合并 officeAddin）。
 */
export default function OfficeAddinSection({ settings, onChange }: OfficeAddinSectionProps) {
  const l = useLocaleText();
  const [status, setStatus] = useState<OfficeBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const current = settings ?? DEFAULT_OFFICE_ADDIN_SETTINGS;

  const refresh = useCallback(async () => {
    try {
      setStatus(await getOfficeAddinStatus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<OfficeBridgeStatus>, successText: string) => {
    setBusy(true);
    setNotice('');
    try {
      const next = await action();
      setStatus(next);
      setNotice(next.error ? next.error : successText);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const patch = (partial: Partial<OfficeAddinSettings>) => onChange({ ...current, ...partial });
  const connectionInfo = status ? formatOfficeConnectionInfo(status) : '';
  const running = Boolean(status?.running);

  const source = status?.source ?? null;
  const sourceSettings = normalizeOfficeAddinSourceSettings(current.source);
  const patchSource = (partial: Partial<OfficeAddinSourceSettings>) =>
    patch({ source: { ...sourceSettings, ...partial } });
  const sourceRunning = Boolean(source?.running);
  const certificate = source?.certificate ?? null;
  const certificateSourceLabel =
    certificate?.source === 'installer'
      ? l('来自 exe 安装器', 'from the installer')
      : certificate?.source === 'dev'
        ? l('来自开发脚本', 'from the dev script')
        : l('自动生成', 'generated automatically');

  const trustCertificate = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await trustOfficeAddinCertificate();
      setNotice(
        result.ok
          ? l('证书已加入受信任的根证书颁发机构；若 Word 仍报证书错误，请重启 Word。', 'Certificate added to the trusted root store; restart Word if it still complains.')
          : result.reason ?? l('信任证书失败', 'Failed to trust the certificate'),
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pq-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-[var(--pq-text)]">
            {l('Word 加载项（Office 桥）', 'Word add-in (Office bridge)')}
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--pq-text-muted)]">
            {l(
              '在 Word 里插入可跳转的引用与参考文献表。PaperQuay 运行时加载项自动连接（同源、只在本机），无需复制任何连接信息；文献库数据不出本机。',
              'Insert clickable citations and a bibliography in Word. While PaperQuay is running the add-in connects automatically (same-origin, loopback only) — nothing to copy. Library data never leaves this machine.',
            )}
          </div>
          <div className="mt-2 text-xs text-[var(--pq-text-muted)]">
            {source?.lastClient
              ? l(
                  `Word 已连接 · 最近一次请求 ${new Date(source.lastClient.at).toLocaleString()}`,
                  `Word connected · last request ${new Date(source.lastClient.at).toLocaleString()}`,
                )
              : l('尚未有 Word 加载项连接（在 Word 的「PaperQuay」选项卡打开面板即可）。', 'No Word add-in has connected yet (open the pane from the “PaperQuay” tab in Word).')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={[
              'inline-flex h-2.5 w-2.5 rounded-full',
              running ? 'bg-emerald-500' : 'bg-[var(--pq-surface-3)]',
            ].join(' ')}
          />
          <span className="text-xs text-[var(--pq-text-muted)]">
            {running && status?.url
              ? l(`运行中 · ${status.url}`, `Running · ${status.url}`)
              : l('未运行', 'Not running')}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-[var(--pq-text)]">
                {l('加载项页面源站', 'Add-in page source')}
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--pq-text-muted)]">
                {l(
                  'Word 从这里取任务窗格页面。源站由 PaperQuay 自己托管（只绑 127.0.0.1）、随应用启停；exe 安装器只负责清单、证书与侧载注册表。',
                  'Word loads the task pane from this local source, served by PaperQuay itself (loopback only). The installer only writes the manifest, certificate and sideload registry key.',
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={[
                  'inline-flex h-2.5 w-2.5 rounded-full',
                  sourceRunning ? 'bg-emerald-500' : 'bg-[var(--pq-surface-3)]',
                ].join(' ')}
              />
              <span className="text-xs text-[var(--pq-text-muted)]">
                {sourceRunning && source?.origin ? source.origin : l('未运行', 'Not running')}
              </span>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-[var(--pq-text)]">
                  {l('随应用托管加载项页面', 'Serve the add-in pages with the app')}
                </div>
                <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
                  {l('关闭后 Word 里的加载项无法加载页面。', 'When disabled, Word cannot load the add-in pages.')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => patchSource({ enabled: !sourceSettings.enabled })}
                className={[
                  'relative h-7 w-12 shrink-0 rounded-full transition',
                  sourceSettings.enabled ? 'bg-[var(--pq-accent)]' : 'bg-[var(--pq-surface-3)]',
                ].join(' ')}
                aria-label={l('托管加载项页面', 'Serve add-in pages')}
              >
                <span
                  className={[
                    'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                    sourceSettings.enabled ? 'left-6' : 'left-1',
                  ].join(' ')}
                />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--pq-text-muted)]">{l('HTTPS 端口', 'HTTPS port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={sourceSettings.httpsPort}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(value)) patchSource({ httpsPort: value });
                  }}
                  className="w-20 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-2 py-1 text-sm text-[var(--pq-text)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--pq-text-muted)]">{l('回退 HTTP 端口', 'HTTP fallback port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={sourceSettings.httpPort}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(value)) patchSource({ httpPort: value });
                  }}
                  className="w-20 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-2 py-1 text-sm text-[var(--pq-text)]"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--pq-text-muted)]">
                <input
                  type="checkbox"
                  checked={sourceSettings.allowHttpFallback}
                  onChange={(event) => patchSource({ allowHttpFallback: event.target.checked })}
                />
                {l('证书不可用时回退 HTTP', 'Fall back to HTTP without a certificate')}
              </label>
            </div>
            <div className="text-xs leading-5 text-[var(--pq-text-muted)]">
              {l(
                '改端口后点“重启桥”生效；Word 清单里的地址必须与端口一致（exe 安装器按端口写清单）。',
                'Restart the bridge after changing ports; the manifest must match the port (the installer writes it accordingly).',
              )}
            </div>

            <div className="text-xs leading-5 text-[var(--pq-text-muted)]">
              {certificate?.available
                ? l(
                    `证书就绪（${certificateSourceLabel}）：${certificate.dir ?? ''}`,
                    `Certificate ready (${certificateSourceLabel}): ${certificate.dir ?? ''}`,
                  )
                : l(
                    `证书不可用：${certificate?.reason ?? l('未知原因', 'unknown')}`,
                    `Certificate unavailable: ${certificate?.reason ?? 'unknown'}`,
                  )}
            </div>

            {source?.installed ? (
              <div className="text-xs leading-5 text-[var(--pq-text-muted)]">
                {l(
                  `已由安装器侧载：${source.installed.manifestPath}${source.installed.installedAt ? `（${source.installed.installedAt}）` : ''}${source.installed.trusted ? '，证书已信任' : ''}`,
                  `Sideloaded by the installer: ${source.installed.manifestPath}${source.installed.installedAt ? ` (${source.installed.installedAt})` : ''}${source.installed.trusted ? ', certificate trusted' : ''}`,
                )}
              </div>
            ) : (
              <div className="text-xs leading-5 text-[var(--pq-text-muted)]">
                {l(
                  `未检测到安装器写入的清单。可双击 PaperQuay-OfficeAddin-Setup.exe 一键安装（清单写到 ${source?.installDir ?? ''}）。`,
                  `No installer manifest found. Run PaperQuay-OfficeAddin-Setup.exe to install it (manifest goes to ${source?.installDir ?? ''}).`,
                )}
              </div>
            )}

            {source?.note ? (
              <div className="text-xs leading-5 text-amber-600 dark:text-amber-300">{source.note}</div>
            ) : null}
            {source?.error ? (
              <div className="text-xs leading-5 text-rose-600 dark:text-rose-300">{source.error}</div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void trustCertificate()}
                className="pq-button h-8 gap-1.5 px-3 text-xs disabled:opacity-60"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {l('信任本地证书', 'Trust local certificate')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void revealOfficeAddinSource().catch((error) =>
                    setNotice(error instanceof Error ? error.message : String(error)),
                  );
                }}
                className="pq-button h-8 gap-1.5 px-3 text-xs"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {l('打开加载项目录', 'Open add-in folder')}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--pq-text)]">
              {l('随应用启动桥', 'Start bridge with the app')}
            </div>
            <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
              {l('关闭后 Word 加载项无法连接。', 'When disabled the Word add-in cannot connect.')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => patch({ enabled: !current.enabled })}
            className={[
              'relative h-7 w-12 shrink-0 rounded-full transition',
              current.enabled ? 'bg-[var(--pq-accent)]' : 'bg-[var(--pq-surface-3)]',
            ].join(' ')}
            aria-label={l('启用 Office 桥', 'Enable Office bridge')}
          >
            <span
              className={[
                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                current.enabled ? 'left-6' : 'left-1',
              ].join(' ')}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--pq-text)]">
              {l('端口', 'Port')}
            </div>
            <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
              {l(
                '默认 23120（Zotero 用 23119）；被占用时自动顺延。改端口后点击“重启桥”。',
                'Defaults to 23120 (Zotero uses 23119) and shifts when occupied. Restart the bridge after changing it.',
              )}
            </div>
          </div>
          <input
            type="number"
            min={1024}
            max={65535}
            value={current.port}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              patch({ port: Number.isFinite(value) ? value : DEFAULT_OFFICE_ADDIN_SETTINGS.port });
            }}
            className="w-28 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-2 py-1 text-sm text-[var(--pq-text)]"
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-[var(--pq-text)]">
              {l('允许回写“本文引用过”', 'Allow writing back “cited in this document”')}
            </div>
            <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
              {l(
                '唯一的写入路径：在文献库里记录某篇文献被哪些 Word 文档引用过。',
                'The only write path: record which Word documents cite a paper.',
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => patch({ allowWriteBack: !current.allowWriteBack })}
            className={[
              'relative h-7 w-12 shrink-0 rounded-full transition',
              current.allowWriteBack ? 'bg-[var(--pq-accent)]' : 'bg-[var(--pq-surface-3)]',
            ].join(' ')}
            aria-label={l('允许回写引用记录', 'Allow write-back')}
          >
            <span
              className={[
                'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
                current.allowWriteBack ? 'left-6' : 'left-1',
              ].join(' ')}
            />
          </button>
        </div>

        <div>
          <div className="text-sm font-medium text-[var(--pq-text)]">
            {l('额外的加载项来源白名单', 'Extra add-in origin allowlist')}
          </div>
          <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
            {l(
              '默认已允许 https://localhost:3000 等本地来源；用逗号分隔补充其他 Origin。',
              'Local origins such as https://localhost:3000 are allowed by default; add more, comma-separated.',
            )}
          </div>
          <input
            type="text"
            value={current.allowedOrigins.join(', ')}
            placeholder="https://localhost:3000"
            onChange={(event) =>
              patch({
                allowedOrigins: event.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            className="mt-2 w-full rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-2 py-1 text-sm text-[var(--pq-text)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(running ? stopOfficeBridge : startOfficeBridge, running ? l('已停止桥', 'Bridge stopped') : l('已启动桥', 'Bridge started'))}
            className="pq-button h-8 gap-1.5 px-3 text-xs disabled:opacity-60"
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? l('停止桥', 'Stop bridge') : l('启动桥', 'Start bridge')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(restartOfficeBridge, l('已重启桥', 'Bridge restarted'))}
            className="pq-button h-8 gap-1.5 px-3 text-xs disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {l('重启桥', 'Restart bridge')}
          </button>
        </div>

        <details className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-2)] px-3 py-2 text-xs text-[var(--pq-text-muted)]">
          <summary className="cursor-pointer select-none">
            {l('高级：外部工具的端口/令牌连接', 'Advanced: port/token access for external tools')}
          </summary>
          <div className="mt-2 leading-5">
            {l(
              'Word 加载项不需要这些信息。端口直连通道（127.0.0.1:23120 起，Bearer 令牌）只供冒烟脚本与外部工具使用，令牌每次启动都会变化。',
              'The Word add-in does not need this. The direct port channel (127.0.0.1:23120+, Bearer token) is only for the smoke script and external tools; the token changes on every start.',
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!connectionInfo}
              onClick={() => {
                void copyText(connectionInfo).then((done) =>
                  setNotice(done ? l('连接信息已复制', 'Connection info copied') : l('复制失败，请手动记录端口与令牌', 'Copy failed; note the port and token manually')),
                );
              }}
              className="pq-button h-8 px-3 text-xs disabled:opacity-60"
            >
              {l('复制连接信息', 'Copy connection info')}
            </button>
            <button
              type="button"
              onClick={() => {
                void revealOfficeDiscoveryFile().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
              }}
              className="pq-button h-8 gap-1.5 px-3 text-xs"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {l('打开发现文件', 'Open discovery file')}
            </button>
          </div>
          {connectionInfo ? <div className="mt-2 select-all font-mono text-[var(--pq-text)]">{connectionInfo}</div> : null}
        </details>

        {notice ? (
          <div className="text-xs leading-5 text-[var(--pq-text-muted)]">{notice}</div>
        ) : null}
      </div>
    </section>
  );
}
