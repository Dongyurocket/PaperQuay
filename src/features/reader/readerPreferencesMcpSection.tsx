import { useEffect, useState } from 'react';

import { invoke } from '../../platform/electron/core';
import { SettingsField, SettingsSelect } from './readerPreferencesPrimitives';
import type { ReaderPreferencesLocalizer } from './readerPreferencesTypes';

type McpSnippetClient = 'proma' | 'claude' | 'codex';

interface McpClientConfig {
  mode: 'installed' | 'development';
  entry: string;
  entryExists: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  dataDir: string;
  nodeVersion: string;
  embeddedNodeSatisfiesSqlite: boolean;
  systemNodeVersion: string | null;
  systemNodeSatisfiesSqlite: boolean;
  launchHint: string;
  snippets: Record<McpSnippetClient, string>;
}

export function ReaderPreferencesMcpSection({
  active,
  l,
}: {
  active: boolean;
  l: ReaderPreferencesLocalizer;
}) {
  const [config, setConfig] = useState<McpClientConfig | null>(null);
  const [error, setError] = useState('');
  const [client, setClient] = useState<McpSnippetClient>('proma');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setError('');
    invoke<McpClientConfig>('mcp_get_client_config')
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((invokeError: unknown) => {
        if (!cancelled) {
          setError(invokeError instanceof Error ? invokeError.message : String(invokeError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  const snippet = config?.snippets[client] ?? '';
  const installed = config?.mode === 'installed';

  async function copySnippet() {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  }

  return (
    <SettingsField
      label={l('MCP 服务', 'MCP Service')}
      description={l(
        '把随安装包发布的知识库服务接给外部 Agent。安装版用应用自带的 Electron 作为 Node 启动，不需要另装 Node.js。',
        'Connect the packaged knowledge service to an external agent. Installed builds launch it with the app Electron binary, so a separate Node.js install is not required.',
      )}
    >
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]">
          <div className="font-medium text-slate-800 dark:text-[var(--pq-text)]">
            {installed ? l('已安装桌面版', 'Installed app') : l('开发模式', 'Development')}
          </div>
          <div className="mt-1 break-all">{config?.entry || l('正在读取服务路径', 'Reading the service path')}</div>
          {config && !config.entryExists ? (
            <div className="mt-1 text-amber-700">
              {l('入口文件当前不存在。安装包需先完成 MCP bundle 构建。', 'The entry file is missing. Build the MCP bundle before packaging.')}
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600 dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]">
          <div>
            {l('内嵌 Node', 'Embedded Node')}: {config?.nodeVersion || '—'}
            {config ? ` · ${config.embeddedNodeSatisfiesSqlite ? 'node:sqlite OK' : l('低于 22.5', 'below 22.5')}` : ''}
          </div>
          <div className="mt-1">
            {l('系统 Node', 'System Node')}: {config?.systemNodeVersion || l('未检测到', 'Not detected')}
            {config?.systemNodeVersion
              ? ` · ${config.systemNodeSatisfiesSqlite ? 'node:sqlite OK' : l('需要 22.5 或更高', '22.5 or newer required')}`
              : ''}
          </div>
          <div className="mt-1">
            {installed
              ? l(
                '安装版使用应用自带的 Electron 作为 Node 启动，不需要另装 Node.js。',
                'The installed app launches this service with its Electron binary. A separate Node.js install is not required.',
              )
              : l(
                '开发模式使用系统 Node。node:sqlite 需要 Node.js 22.5 或更高版本。',
                'Development mode uses system Node. node:sqlite requires Node.js 22.5 or newer.',
              )}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] leading-5 text-slate-400 dark:text-[var(--pq-text-faint)]">
        {l(
          `片段已带上当前数据目录 ${config?.dataDir || '（读取后显示）'}。外部 Agent 若要改用其他目录，替换 args 里的 --data-dir 值。`,
          `The snippet includes the current data directory ${config?.dataDir || '(shown after load)'}. Replace the --data-dir value if an external agent should use another directory.`,
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SettingsSelect
          value={client}
          onChange={(event) => {
            setClient(event.target.value as McpSnippetClient);
            setCopied(false);
          }}
          className="max-w-xs"
        >
          <option value="proma">Proma</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </SettingsSelect>
        <button
          type="button"
          onClick={() => { void copySnippet(); }}
          disabled={!snippet}
          className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-white/10 dark:bg-[var(--pq-surface-1)] dark:text-[var(--pq-text-muted)]"
        >
          {copied ? l('已复制', 'Copied') : l('复制配置', 'Copy config')}
        </button>
      </div>
      <textarea
        readOnly
        value={snippet}
        className="mt-3 h-56 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-700 outline-none dark:border-white/10 dark:bg-[var(--pq-surface-2)] dark:text-[var(--pq-text-muted)]"
      />
    </SettingsField>
  );
}
