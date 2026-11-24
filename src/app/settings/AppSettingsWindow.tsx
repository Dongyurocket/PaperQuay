import { Archive, RefreshCw, Settings2, Wrench } from 'lucide-react';

import { Dialog } from '../../ui/dialog';
import { emitOpenPreferences } from '../appEvents';
import { pickLocaleText } from '../../features/reader/readerShared';
import { patchAppSettingsAndSync } from './appSettingsCache';
import { BackupTransferSection } from './BackupTransferSection';
import { McpSettingsSection } from './McpSettingsSection';
import { SettingsField, SettingsSelect } from './settingsPrimitives';
import type { SettingsLocalizer, SettingsSectionDescriptor } from './settingsTypes';
import { UpdateSettingsSection } from './UpdateSettingsSection';
import { useAppSettingsSnapshot } from './useAppSettings';
import { useAppSettingsStore, type AppSettingsSectionKey } from './useAppSettingsStore';

function buildSections(l: SettingsLocalizer): SettingsSectionDescriptor[] {
  return [
    {
      key: 'general',
      title: l('通用', 'General'),
      description: l('界面语言与基础应用行为', 'Interface language and basic app behavior'),
      icon: <Settings2 className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'backup',
      title: l('备份与迁移', 'Backup & Transfer'),
      description: l(
        '导出加密备份包、迁移数据或回滚到导入前版本',
        'Export encrypted backups, migrate data, or roll back to a previous version',
      ),
      icon: <Archive className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'mcp',
      title: l('MCP 服务', 'MCP Service'),
      description: l(
        '安装版知识库服务路径与外部 Agent 配置',
        'Installed knowledge service path and external agent config',
      ),
      icon: <Wrench className="h-4 w-4" strokeWidth={1.8} />,
    },
    {
      key: 'updates',
      title: l('软件更新', 'Software Updates'),
      description: l('检查 GitHub 发布版本并安装更新', 'Check GitHub releases and install updates'),
      icon: <RefreshCw className="h-4 w-4" strokeWidth={1.8} />,
    },
  ];
}

/**
 * 应用级设置窗口：只承载与 Reader 无关的通用/备份/MCP/更新设置。
 * 窗口生命周期由 App 持有，Notes 与 Graph 工作区也能打开。
 */
export function AppSettingsWindow() {
  const open = useAppSettingsStore((state) => state.open);
  const activeSection = useAppSettingsStore((state) => state.section);
  const closeSettings = useAppSettingsStore((state) => state.closeSettings);
  const snapshot = useAppSettingsSnapshot();
  const uiLanguage = snapshot?.settings.uiLanguage ?? 'zh-CN';
  const l: SettingsLocalizer = (zh, en) => pickLocaleText(uiLanguage, zh, en);
  const sections = buildSections(l);

  if (!open) {
    return null;
  }

  const setSection = (section: AppSettingsSectionKey) => {
    useAppSettingsStore.setState({ section });
  };

  const changeLanguage = (value: string) => {
    void patchAppSettingsAndSync({ uiLanguage: value === 'en-US' ? 'en-US' : 'zh-CN' });
  };

  return (
    <Dialog
      open
      onClose={closeSettings}
      overlay="strong"
      size="xl"
      labelledBy="pq-app-settings-title"
      className="!max-w-[min(1080px,calc(100vw-32px))]"
    >
      <div className="flex h-[min(680px,calc(100vh-32px))] overflow-hidden">
        <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-[var(--pq-border)] bg-[var(--pq-sidebar)] px-4 py-4 backdrop-blur-xl">
          <div className="shrink-0 px-3 pb-4">
            <h2 id="pq-app-settings-title" className="mt-2 text-2xl font-semibold tracking-tight text-[var(--pq-text)]">
              {l('设置', 'Settings')}
            </h2>
            <div className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l(
                '应用级设置：备份、MCP 服务与软件更新。',
                'App settings: backups, the MCP service, and software updates.',
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setSection(section.key as AppSettingsSectionKey)}
                className={[
                  'flex w-full items-start gap-3 rounded-[var(--pq-radius-md)] px-3 py-3 text-left transition-all duration-200',
                  activeSection === section.key
                    ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)] ring-1 ring-[var(--pq-focus-ring)]'
                    : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                ].join(' ')}
              >
                <span className="mt-0.5">{section.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{section.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--pq-text-faint)]">
                    {section.description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              closeSettings();
              emitOpenPreferences();
            }}
            className="mt-4 shrink-0 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-3 py-2 text-left text-xs leading-5 text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]"
          >
            {l('阅读、翻译与模型设置…', 'Reading, translation & model settings…')}
          </button>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-6 py-4">
            <div>
              <div className="text-sm font-semibold text-[var(--pq-text)]">
                {sections.find((section) => section.key === activeSection)?.title}
              </div>
              <div className="mt-1 text-xs text-[var(--pq-text-muted)]">
                {sections.find((section) => section.key === activeSection)?.description}
              </div>
            </div>
            <button type="button" className="pq-button h-8 px-3 text-xs" onClick={closeSettings}>
              {l('关闭', 'Close')}
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {activeSection === 'general' ? (
              <div className="space-y-4">
                <SettingsField
                  label={l('界面语言', 'Interface language')}
                  description={l(
                    '立即应用到所有工作区；写入主进程设置文档。',
                    'Applies to every workspace and is stored in the main-process settings document.',
                  )}
                >
                  <SettingsSelect
                    aria-label={l('界面语言', 'Interface language')}
                    value={uiLanguage}
                    onChange={(event) => changeLanguage(event.target.value)}
                  >
                    <option value="zh-CN">中文</option>
                    <option value="en-US">English</option>
                  </SettingsSelect>
                </SettingsField>
              </div>
            ) : null}

            <BackupTransferSection active={activeSection === 'backup'} l={l} />
            <McpSettingsSection active={activeSection === 'mcp'} l={l} />
            <UpdateSettingsSection active={activeSection === 'updates'} l={l} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
