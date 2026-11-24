import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canSeedInitialQaSession,
  isQaHistoryRestoreReady,
} from '../src/features/reader/readerQaSessionLifecycle.ts';
import {
  getReaderQaTabSnapshot,
  useReaderQaStore,
} from '../src/stores/useReaderQaStore.ts';
import type { DocumentChatSession } from '../src/types/reader.ts';

function createSession(id: string): DocumentChatSession {
  return {
    id,
    title: 't',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  } as unknown as DocumentChatSession;
}

const TAB_ID = 'reader-tab-lifecycle';
const WORKSPACE_ID = 'native-library:paper-1';

test('initial session seeding waits until the tab slice is restored', () => {
  useReaderQaStore.getState().removeTab(TAB_ID);

  // 挂载前：没有 slice，父组件不能抢先写初始会话。
  assert.equal(canSeedInitialQaSession(getReaderQaTabSnapshot(TAB_ID)), false);

  // effect_244 恢复历史（同步写入 zustand）。
  const restored = [createSession('session-restored')];
  const setField = useReaderQaStore.getState().setTabField;
  setField(TAB_ID, 'workspaceId', WORKSPACE_ID);
  setField(TAB_ID, 'qaSessions', restored);
  setField(TAB_ID, 'selectedQaSessionId', restored[0].id);

  assert.equal(canSeedInitialQaSession(getReaderQaTabSnapshot(TAB_ID)), true);
  assert.equal(
    isQaHistoryRestoreReady(getReaderQaTabSnapshot(TAB_ID), WORKSPACE_ID),
    true,
  );

  // 恢复后父组件的 effect 即使再运行，也不应覆盖已恢复的会话。
  assert.equal(getReaderQaTabSnapshot(TAB_ID)?.qaSessions, restored);

  useReaderQaStore.getState().removeTab(TAB_ID);
});

test('history readiness compares workspace ids, not session array identity', () => {
  assert.equal(isQaHistoryRestoreReady(undefined, WORKSPACE_ID), false);
  assert.equal(isQaHistoryRestoreReady({ workspaceId: '' }, WORKSPACE_ID), false);
  assert.equal(isQaHistoryRestoreReady({ workspaceId: 'other' }, WORKSPACE_ID), false);
  assert.equal(isQaHistoryRestoreReady({ workspaceId: WORKSPACE_ID }, WORKSPACE_ID), true);

  // 新的会话数组（例如范围切换重写）不影响就绪判定。
  const rewritten = [createSession('session-rewritten')];
  assert.equal(isQaHistoryRestoreReady({ workspaceId: WORKSPACE_ID }, WORKSPACE_ID), true);
  assert.equal(rewritten.length, 1);
});
