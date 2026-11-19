import { useEffect, useState } from 'react';

export type AppWorkspaceKey = 'library' | 'notes' | 'graph';

const ACTIVE_WORKSPACE_STORAGE_KEY = 'paperquay-active-workspace-v1';

function loadInitialWorkspace(): AppWorkspaceKey {
  const stored = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  // 旧版本保存过 `agent`：独立 Agent 工作区已移除，统一回退到文库。
  return stored === 'notes' || stored === 'graph' ? stored : 'library';
}

export function useWorkspaceRestore(
  activeWorkspace: AppWorkspaceKey,
  openNotesTab: () => unknown,
  openGraphTab: () => unknown,
) {
  const [initialWorkspace] = useState(loadInitialWorkspace);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    if (initialWorkspace === 'notes') openNotesTab();
    if (initialWorkspace === 'graph') openGraphTab();
  }, [initialWorkspace, openGraphTab, openNotesTab]);
}
