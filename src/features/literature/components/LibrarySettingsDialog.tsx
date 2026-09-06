import { useRef } from 'react';
import { Database, FolderOpen, RefreshCw, X } from 'lucide-react';

import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type {
  LibraryImportMode,
  LibrarySettings,
} from '../../../types/library';

interface LibrarySettingsDialogProps {
  open: boolean;
  settings: LibrarySettings | null;
  saving: boolean;
  metadataWorking: boolean;
  onClose: () => void;
  onSelectStorageDir: () => void;
  onDetectZoteroDir: () => void;
  onSelectZoteroDir: () => void;
  onImportZotero: () => void;
  onEnrichAllMetadata: () => void;
  onChange: (settings: LibrarySettings) => void;
  onSave: () => void;
}

function SettingLabel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-[var(--pq-text)]">{title}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--pq-text-muted)]">
        {description}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        'relative h-7 w-12 rounded-full transition',
        checked ? 'bg-[var(--pq-accent)]' : 'bg-[var(--pq-surface-3)]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition',
          checked ? 'left-6' : 'left-1',
        ].join(' ')}
      />
    </button>
  );
}

export default function LibrarySettingsDialog({
  open,
  settings,
  saving,
  metadataWorking,
  onClose,
  onSelectStorageDir,
  onDetectZoteroDir,
  onSelectZoteroDir,
  onImportZotero,
  onEnrichAllMetadata,
  onChange,
  onSave,
}: LibrarySettingsDialogProps) {
  const l = useLocaleText();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef: panelRef });

  if (!open || !settings) {
    return null;
  }

  const patch = (partial: Partial<LibrarySettings>) => onChange({ ...settings, ...partial });

  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/42 px-4 py-6 backdrop-blur-sm dark:bg-black/56">
      <div
        ref={panelRef}
        onWheelCapture={handleWheelCapture}
        className="flex max-h-[min(720px,calc(100vh-32px))] w-[min(820px,calc(100vw-32px))] flex-col overflow-hidden rounded-[var(--pq-radius-lg)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] text-[var(--pq-text)] shadow-[var(--pq-shadow-dialog)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--pq-border)] px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--pq-text-faint)]">
              {l('文库设置', 'Library Settings')}
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {l('本地文献与 Zotero 导入', 'Local Library and Zotero Import')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
              {l(
                '这里配置 PaperQuay 自己的文献库，也可以把 Zotero 本地分类和 PDF 导入为本地分类。',
                'Configure PaperQuay’s native library and import Zotero local collections and PDFs as native categories.',
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="pq-icon-button h-10 w-10 shrink-0 border border-[var(--pq-border)] bg-[var(--pq-surface-1)] disabled:opacity-60"
            aria-label={l('关闭', 'Close')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>

        <div
          data-wheel-scroll-target
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-6 py-5"
        >
          <section className="pq-card p-4">
            <SettingLabel
              title={l('默认文献存储文件夹', 'Default Paper Storage Folder')}
              description={l(
                '导入时选择复制或移动，PDF 会进入这个文件夹；选择保留原路径时不会复制文件。',
                'When import mode is copy or move, PDFs are placed here. Keep-path mode does not copy files.',
              )}
            />
            <div className="mt-3 flex gap-2">
              <input
                value={settings.storageDir}
                onChange={(event) => patch({ storageDir: event.target.value })}
                className="pq-input h-11 min-w-0 flex-1 px-3 text-sm"
              />
              <button
                type="button"
                onClick={onSelectStorageDir}
                className="pq-button h-11 px-3 text-sm"
              >
                <FolderOpen className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('选择', 'Choose')}
              </button>
            </div>
          </section>

          <section className="pq-card p-4">
            <SettingLabel
              title={l('统一译文 PDF 存放文件夹', 'Unified Translated PDF Folder')}
              description={l(
                '附加的翻译版 PDF 会集中复制到此文件夹管理；留空时默认存放于文献库目录下的 translated-pdfs 文件夹。',
                'Attached translated PDFs are centralized in this folder; leaves empty to use <library storage>/translated-pdfs by default.',
              )}
            />
            <div className="mt-3 flex gap-2">
              <input
                value={settings.translatedPdfDir ?? ''}
                onChange={(event) => patch({ translatedPdfDir: event.target.value })}
                placeholder={l('留空默认保存在 <文献库目录>/translated-pdfs', 'Leave empty to use <library storage>/translated-pdfs by default')}
                className="pq-input h-11 min-w-0 flex-1 px-3 text-sm"
              />
              {settings.translatedPdfDir ? (
                <button
                  type="button"
                  onClick={() => patch({ translatedPdfDir: '' })}
                  className="pq-button h-11 px-3 text-sm text-[var(--pq-text-muted)]"
                >
                  {l('恢复默认', 'Reset')}
                </button>
              ) : null}
            </div>
          </section>

          <section className="pq-card p-4">
            <SettingLabel
              title={l('Zotero 本地数据目录', 'Zotero Local Data Directory')}
              description={l(
                '选择包含 zotero.sqlite 的 Zotero 数据目录。导入时会读取 Zotero 分类树，并把分类下的 PDF 导入当前本地文献库。',
                'Choose the Zotero data directory containing zotero.sqlite. Import reads the Zotero collection tree and imports PDFs into the native library.',
              )}
            />
            <div className="mt-3 flex gap-2">
              <input
                value={settings.zoteroLocalDataDir}
                onChange={(event) => patch({ zoteroLocalDataDir: event.target.value })}
                placeholder={l('例如 C:\\Users\\Lenovo\\Zotero', 'Example: C:\\Users\\Lenovo\\Zotero')}
                className="pq-input h-11 min-w-0 flex-1 px-3 text-sm"
              />
              <button
                type="button"
                onClick={onDetectZoteroDir}
                className="pq-button h-11 px-3 text-sm"
              >
                <RefreshCw className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('自动检测', 'Detect')}
              </button>
              <button
                type="button"
                onClick={onSelectZoteroDir}
                className="pq-button h-11 px-3 text-sm"
              >
                <FolderOpen className="mr-2 h-4 w-4" strokeWidth={1.9} />
                {l('选择', 'Choose')}
              </button>
            </div>
            <button
              type="button"
              onClick={onImportZotero}
              disabled={saving}
              className="pq-button-primary mt-3 h-11 px-4 text-sm disabled:opacity-60"
            >
              <Database className="mr-2 h-4 w-4" strokeWidth={1.9} />
              {l('导入 Zotero 分类和 PDF', 'Import Zotero Collections and PDFs')}
            </button>
          </section>

          <section className="pq-card p-4">
            <SettingLabel
              title={l('全部文献元数据解析', 'Parse Metadata for All Papers')}
              description={l(
                '按 DOI、标题和 PDF 文件名批量查询 OpenAlex，并用 Crossref 兜底补全标题、作者、年份、期刊、DOI、URL 和摘要。已有内容不会被清空。',
                'Batch query OpenAlex by DOI, title, and PDF filename, with Crossref fallback, to enrich title, authors, year, venue, DOI, URL, and abstract. Existing content is never cleared.',
              )}
            />
            <button
              type="button"
              onClick={onEnrichAllMetadata}
              disabled={saving || metadataWorking}
              className="pq-button mt-3 h-11 px-4 text-sm text-[var(--pq-accent)] disabled:opacity-60"
            >
              <RefreshCw
                className={metadataWorking ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'}
                strokeWidth={1.9}
              />
              {metadataWorking
                ? l('正在解析全部文献...', 'Parsing all papers...')
                : l('解析全部文献元数据', 'Parse All Metadata')}
            </button>
          </section>

          <section className="pq-card space-y-4 p-4">
            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('OpenAlex 元数据源', 'OpenAlex Metadata Source')}
                description={l(
                  '开启后导入和批量解析会优先查询 OpenAlex。API Key 可选；填写邮箱会进入 OpenAlex polite pool，适合稳定批量查询。',
                  'When enabled, import and batch parsing query OpenAlex first. API key is optional; mailto puts requests in the OpenAlex polite pool for steadier batch lookup.',
                )}
              />
              <Toggle
                checked={settings.openAlexEnabled}
                onChange={(checked) => patch({ openAlexEnabled: checked })}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-[var(--pq-text-muted)]">
                  {l('OpenAlex API Key（可选）', 'OpenAlex API Key (optional)')}
                </span>
                <input
                  type="password"
                  value={settings.openAlexApiKey}
                  onChange={(event) => patch({ openAlexApiKey: event.target.value })}
                  placeholder={l('Premium key，可留空', 'Premium key, can be empty')}
                  className="pq-input mt-1.5 h-10 w-full px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--pq-text-muted)]">
                  {l('OpenAlex mailto（推荐）', 'OpenAlex mailto (recommended)')}
                </span>
                <input
                  value={settings.openAlexMailto}
                  onChange={(event) => patch({ openAlexMailto: event.target.value })}
                  placeholder="name@example.com"
                  className="pq-input mt-1.5 h-10 w-full px-3 text-sm"
                />
              </label>
            </div>
          </section>

          <section className="pq-card grid gap-4 p-4 md:grid-cols-[1fr_260px]">
            <SettingLabel
              title={l('导入文件处理方式', 'Import File Handling')}
              description={l(
                '复制最安全；移动会整理原文件；保留原路径适合只建立索引。导入 Zotero 时通常建议使用复制。',
                'Copy is safest. Move organizes original files. Keep path indexes files without copying.',
              )}
            />
            <select
              value={settings.importMode}
              onChange={(event) => patch({ importMode: event.target.value as LibraryImportMode })}
              className="pq-input h-11 px-3 text-sm"
            >
              <option value="copy">{l('复制到文献库文件夹', 'Copy into library folder')}</option>
              <option value="move">{l('移动到文献库文件夹', 'Move into library folder')}</option>
              <option value="keep">{l('保留原路径', 'Keep original path')}</option>
            </select>
          </section>

          <section className="pq-card p-4">
            <SettingLabel
              title={l('文件命名规则', 'File Naming Rule')}
              description={l(
                '可用变量：{firstAuthor}、{year}、{title}、{doi}、{originalName}。',
                'Available variables: {firstAuthor}, {year}, {title}, {doi}, {originalName}.',
              )}
            />
            <input
              value={settings.fileNamingRule}
              onChange={(event) => patch({ fileNamingRule: event.target.value })}
              className="pq-input mt-3 h-11 w-full px-3 font-mono text-sm"
            />
          </section>

          <section className="pq-card space-y-4 p-4">
            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('导入时自动重命名 PDF', 'Automatically Rename PDFs')}
                description={l('开启后按命名规则生成文件名。', 'When enabled, filenames follow the naming rule.')}
              />
              <Toggle
                checked={settings.autoRenameFiles}
                onChange={(checked) => patch({ autoRenameFiles: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('保留原始路径记录', 'Preserve Original Path')}
                description={l('即使复制到文献库，也保留来源路径，方便追溯。', 'Keep the source path even after copying, useful for tracing.')}
              />
              <Toggle
                checked={settings.preserveOriginalPath}
                onChange={(checked) => patch({ preserveOriginalPath: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('按分类创建文件夹', 'Create Category Folders')}
                description={l('规划功能：导入时按目标分类建立子文件夹。', 'Planned: create subfolders by target category during import.')}
              />
              <Toggle
                checked={settings.createCategoryFolders}
                onChange={(checked) => patch({ createCategoryFolders: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                title={l('启用数据库备份', 'Enable Database Backup')}
                description={l('后续版本会在关键操作前自动备份本地文献库。', 'A later version will back up the local library before critical operations.')}
              />
              <Toggle
                checked={settings.backupEnabled}
                onChange={(checked) => patch({ backupEnabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 opacity-70">
              <SettingLabel
                title={l('文件夹监听', 'Folder Watch')}
                description={l('规划功能：监听新增 PDF 并进入导入确认队列。', 'Planned: watch for new PDFs and send them to the import queue.')}
              />
              <Toggle
                checked={settings.folderWatchEnabled}
                onChange={(checked) => patch({ folderWatchEnabled: checked })}
              />
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--pq-border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="pq-button px-4 py-2.5 text-sm disabled:opacity-60"
          >
            {l('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="pq-button-primary px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {saving ? l('正在保存...', 'Saving...') : l('保存设置', 'Save Settings')}
          </button>
        </footer>
      </div>
    </div>
  );
}
