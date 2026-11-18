import { useEffect, useState } from 'react';

export type AppWorkspaceKey = 'library' | 'agent' | 'notes' | 'graph';

const ACTIVE_WORKSPACE_STORAGE_KEY = 'paperquay-active-workspace-v1';

function loadInitialWorkspace(): AppWorkspaceKey {
  const stored = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  return stored === 'agent' || stored === 'notes' || stored === 'graph' ? stored : 'library';
}

export function useWorkspaceRestore(
  activeWorkspace: AppWorkspaceKey,
  openAgentTab: () => unknown,
  openNotesTab: () => unknown,
  openGraphTab: () => unknown,
) {
  const [initialWorkspace] = useState(loadInitialWorkspace);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    if (initialWorkspace === 'agent') openAgentTab();
    if (initialWorkspace === 'notes') openNotesTab();
    if (initialWorkspace === 'graph') openGraphTab();
  }, [initialWorkspace, openAgentTab, openGraphTab, openNotesTab]);
}
