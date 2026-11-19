import { invoke } from '../platform/electron/core.ts';
import { listen } from '../platform/electron/event.ts';

export type ExternalWriteScope = 'library' | 'notes';

export interface ExternalWriteEventDetail {
  scope: ExternalWriteScope;
  revision: number;
  previousRevision: number;
  at: number;
}

export const EXTERNAL_WRITE_EVENT = 'paperquay://external-write';
export const EXTERNAL_LIBRARY_WRITE_EVENT = 'paperquay:external-library-write';
export const EXTERNAL_NOTES_WRITE_EVENT = 'paperquay:external-notes-write';

interface ExternalWriteRevisions {
  library: number;
  notes: number;
}

let started = false;
let revisions: ExternalWriteRevisions = { library: 0, notes: 0 };

function dispatch(detail: ExternalWriteEventDetail) {
  window.dispatchEvent(new CustomEvent<ExternalWriteEventDetail>(
    detail.scope === 'library' ? EXTERNAL_LIBRARY_WRITE_EVENT : EXTERNAL_NOTES_WRITE_EVENT,
    { detail },
  ));
}

function applyRevisions(next: ExternalWriteRevisions, at = Date.now()) {
  for (const scope of ['library', 'notes'] as const) {
    const revision = Number(next?.[scope]) || 0;
    if (revision > revisions[scope]) {
      const previousRevision = revisions[scope];
      revisions = { ...revisions, [scope]: revision };
      dispatch({ scope, revision, previousRevision, at });
    } else if (revision < revisions[scope]) {
      // 标记文件被清理后重新计数：以新值为基线，不重放历史。
      revisions = { ...revisions, [scope]: revision };
    }
  }
}

async function checkRevisions() {
  try {
    applyRevisions(await invoke<ExternalWriteRevisions>('external_write_state'));
  } catch {
    // 浏览器预览或桥接不可用时忽略：文件监听仍会在 Electron 内生效。
  }
}

/**
 * 外部（MCP/其他进程）写入标记 → 渲染层事件。
 *
 * 主进程用 fs.watch 推送 `paperquay://external-write`；watch 不可用时窗口聚焦
 * 或页面重新可见时读取一次版本号，覆盖退化路径。
 */
export function startExternalWriteBridge(): () => void {
  if (started) return () => undefined;
  started = true;

  let unlisten: (() => void) | null = null;
  void listen<ExternalWriteEventDetail>(EXTERNAL_WRITE_EVENT, ({ payload }) => {
    if (!payload?.scope) return;
    const revision = Number(payload.revision) || 0;
    if (revision <= revisions[payload.scope]) return;
    revisions = { ...revisions, [payload.scope]: revision };
    dispatch({ ...payload, at: payload.at || Date.now() });
  }).then((dispose) => { unlisten = dispose; }).catch(() => undefined);

  const onFocus = () => { void checkRevisions(); };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void checkRevisions();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  void checkRevisions();

  return () => {
    started = false;
    unlisten?.();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
