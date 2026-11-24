/**
 * 笔记工作区的纯文案与错误码映射。
 *
 * 这里只放不依赖 React / Electron 的纯函数，便于 tests/notesI18n.test.ts
 * 直接断言中英文案；组件通过 useLocaleText() 的 l 传入本地化器。
 */

/** 入库默认标题：数据层继续写入中文，noteHealth 依赖它判定「无标题」。 */
export const UNTITLED_NOTE_TITLE = '未命名笔记';

export type LocaleText = <T>(zh: T, en: T) => T;

const NOTE_ERROR_TEXT: Record<string, { zh: string; en: string }> = {
  NOTES_LIST_FAILED: { zh: '加载笔记失败', en: 'Failed to load notes' },
  NOTES_SEARCH_FAILED: { zh: '笔记检索失败', en: 'Note search failed' },
  NOTES_INDEX_REBUILD_FAILED: { zh: '重建笔记索引失败', en: 'Failed to rebuild the note index' },
  NOTES_INDEX_STATUS_FAILED: { zh: '读取笔记索引状态失败', en: 'Failed to read note index status' },
  NOTE_READ_FAILED: { zh: '读取笔记失败', en: 'Failed to read the note' },
  NOTE_CREATE_FAILED: { zh: '创建笔记失败', en: 'Failed to create the note' },
  NOTE_UPDATE_FAILED: { zh: '保存笔记失败', en: 'Failed to save the note' },
  NOTE_DELETE_FAILED: { zh: '删除笔记失败', en: 'Failed to delete the note' },
  NOTE_TAGS_FAILED: { zh: '读取笔记标签失败', en: 'Failed to load note tags' },
  NOTE_BACKLINKS_FAILED: { zh: '读取反向链接失败', en: 'Failed to load backlinks' },
  NOTE_VAULT_SETTINGS_READ_FAILED: { zh: '读取笔记 vault 设置失败', en: 'Failed to read notes vault settings' },
  NOTE_VAULT_SETTINGS_WRITE_FAILED: { zh: '保存笔记 vault 设置失败', en: 'Failed to save notes vault settings' },
  NOTE_VAULT_SYNC_FAILED: { zh: '同步笔记 vault 失败', en: 'Failed to sync the notes vault' },
  NOTE_FOLDERS_LIST_FAILED: { zh: '读取笔记文件夹失败', en: 'Failed to load note folders' },
  NOTE_FOLDER_CREATE_FAILED: { zh: '创建文件夹失败', en: 'Failed to create the folder' },
  NOTE_FOLDER_RENAME_FAILED: { zh: '重命名文件夹失败', en: 'Failed to rename the folder' },
  NOTE_FOLDER_DELETE_FAILED: { zh: '删除文件夹失败', en: 'Failed to delete the folder' },
  NOTE_CONFLICT: { zh: '笔记已在别处更新，请刷新后重试', en: 'Note was updated elsewhere. Refresh and try again.' },
  NOTE_NOT_FOUND: { zh: '笔记不存在', en: 'Note not found' },
  PAPER_NOT_FOUND: { zh: '文献不存在或已被删除', en: 'Paper not found or deleted' },
  FOLDER_NOT_FOUND: { zh: '分类不存在', en: 'Category not found' },
  CATEGORY_CONFLICT: { zh: '分类冲突，请刷新后重试', en: 'Category conflict. Refresh and try again.' },
  INVALID_ARGUMENT: { zh: '请求参数无效', en: 'Invalid request' },
  VAULT_DIR_NOT_FOUND: { zh: '未找到笔记 vault 目录', en: 'Notes vault folder not found' },
  NOTE_DISTILL_MODEL_MISSING: {
    zh: '请先在模型设置中配置可用的问答或 Agent 模型',
    en: 'Configure a QA or agent model in model settings first',
  },
  NOTE_DISTILL_FAILED: { zh: '提炼摘录失败', en: 'Failed to distill the excerpt' },
};

const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const CODE_PREFIX = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/;
// 真实 Electron IPC 拒绝形如：
// "Error invoking remote method 'paperquay:invoke': Error: NOTE_CONFLICT: expected 3"。
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*':\s*/i;
const ERROR_PREFIX = /^Error:\s*/i;

/** 反复剥离 IPC/Error 包裹前缀，允许 "Error: Error: ..." 这类多层包裹。 */
function stripErrorPrefixes(text: string): string {
  let current = text.trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const next = current.replace(IPC_ERROR_PREFIX, '').replace(ERROR_PREFIX, '').trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function matchStableCode(text: string): string | null {
  const match = CODE_PREFIX.exec(stripErrorPrefixes(text));
  return match ? match[1] : null;
}

/** 从 NoteServiceError / 后端错误前缀（如 NOTE_CONFLICT:）里提取稳定码。 */
export function noteErrorCode(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    return matchStableCode(value);
  }

  if (typeof value === 'object') {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' && STABLE_CODE_PATTERN.test(code.trim())) {
      return code.trim();
    }

    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') {
      return matchStableCode(message);
    }
  }

  return null;
}

/**
 * 把错误映射成双语友好文案：已知码查表，未知码一律回退到通用文案，
 * 绝不回显后端原始错误（尤其不能把后端中文直接渲染给英文界面）。
 */
export function noteErrorMessage(value: unknown, l: LocaleText): string {
  const code = noteErrorCode(value);
  const text = code ? NOTE_ERROR_TEXT[code] : undefined;
  if (text) return l(text.zh, text.en);

  return l('操作失败', 'Operation failed');
}

/**
 * 笔记检索降级提示。
 *
 * 后端（electron/backend/noteHybridSearch.cjs）返回的 warning 是中文原文，
 * 这里只按已知模式映射固定双语文案；其他任何 warning 都回退到通用提示，
 * 绝不把后端原文透传到界面（英文界面尤其不能出现中文）。
 */
export function noteSearchWarningText(
  warning: string | undefined | null,
  l: LocaleText,
): string | null {
  const text = warning?.trim();
  if (!text) return null;

  if (text.includes('Embedding 未在 PaperQuay 中配置') || text.includes('Embedding 未配置')) {
    return l('Embedding 未配置，已降级为关键词检索。', 'Embedding is not configured; using keyword search.');
  }
  if (
    text.includes('没有与当前模型及正文版本匹配的向量结果') ||
    text.includes('没有匹配的向量') ||
    text.includes('没有匹配向量')
  ) {
    return l('没有匹配的向量结果，已降级为关键词检索。', 'No matching vectors; using keyword search.');
  }
  if (text.includes('向量检索失败')) {
    return l('向量检索失败，已降级为关键词检索。', 'Vector search failed; using keyword search.');
  }

  return l('语义检索暂不可用，结果可能仅来自关键词。', 'Semantic search is unavailable; results may be keyword-only.');
}

export interface ConfirmCopy {
  title: string;
  description: string;
  confirmLabel?: string;
  danger: boolean;
}

export interface VaultSyncStatsLike {
  imported: number;
  created: number;
  exported: number;
  removed: number;
  conflicts: number;
}

/** vault 删除熔断触发时的确认框文案（数量超过安全阈值，删除后不可撤销）。 */
export function buildVaultRemovalConfirm(pendingRemovals: number, l: LocaleText): ConfirmCopy {
  return {
    title: l('确认清理 vault 文件', 'Clean up vault files?'),
    description: l(
      `本次同步检测到 ${pendingRemovals} 个文件对应的笔记已不存在，数量超过安全阈值。` +
        '继续会从 vault 删除这些 Markdown 文件（PaperQuay 内笔记不受影响）。',
      `This sync found ${pendingRemovals} files whose notes no longer exist, above the safety threshold. ` +
        'Continuing deletes these Markdown files from the vault (notes inside PaperQuay are not affected).',
    ),
    confirmLabel: l('删除文件', 'Delete files'),
    danger: true,
  };
}

export function buildVaultSyncMessage(stats: VaultSyncStatsLike, l: LocaleText): string {
  return l(
    `同步完成：导入 ${stats.imported}（新建 ${stats.created}）、导出 ${stats.exported}、清理 ${stats.removed}、冲突副本 ${stats.conflicts}`,
    `Sync complete: imported ${stats.imported} (created ${stats.created}), exported ${stats.exported}, ` +
      `cleaned up ${stats.removed}, conflict copies ${stats.conflicts}`,
  );
}

export function buildVaultSyncDeferredMessage(
  stats: VaultSyncStatsLike,
  pendingRemovals: number,
  l: LocaleText,
): string {
  return l(
    `同步完成：导入 ${stats.imported}、导出 ${stats.exported}；已暂缓清理 ${pendingRemovals} 个文件`,
    `Sync complete: imported ${stats.imported}, exported ${stats.exported}; ` +
      `cleanup of ${pendingRemovals} files deferred`,
  );
}

export function buildFolderDeleteConfirm(
  folderName: string,
  hasNotes: boolean,
  l: LocaleText,
): ConfirmCopy {
  return {
    title: l(`删除分类「${folderName}」`, `Delete category "${folderName}"`),
    description: hasNotes
      ? l(
          `删除“${folderName}”及其子分类？其中的笔记会移动到未分类。`,
          `Delete "${folderName}" and its subcategories? Notes inside will move to Uncategorized.`,
        )
      : l(
          `删除“${folderName}”及其子分类？`,
          `Delete "${folderName}" and its subcategories?`,
        ),
    danger: true,
  };
}

export function buildNotesIndexQueuedMessage(queued: number, l: LocaleText): string {
  return l(
    `笔记索引已排队：${queued} 篇`,
    `Note index queued: ${queued} notes`,
  );
}

export function buildNotesIndexProgressMessage(
  status: { completed: number; failed: number; pending: number },
  l: LocaleText,
): string {
  return l(
    `笔记索引：完成 ${status.completed}，失败 ${status.failed}，待处理 ${status.pending}`,
    `Note index: ${status.completed} done, ${status.failed} failed, ${status.pending} pending`,
  );
}

export function buildNotesIndexDoneMessage(
  status: { completed: number; failed: number; lastError?: string | null },
  l: LocaleText,
): string {
  // lastError 可能是后端原始错误，不直接渲染，只提示查看日志。
  const suffix = status.lastError
    ? l('（部分失败，详情见日志）', ' (some failed; see logs)')
    : '';
  return l(
    `笔记索引完成：${status.completed} 篇，失败 ${status.failed}${suffix}`,
    `Note index complete: ${status.completed} notes, ${status.failed} failed${suffix}`,
  );
}
