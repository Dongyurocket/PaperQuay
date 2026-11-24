import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  chooseMountedReaderTabIds,
  collectBusyReaderTabIds,
} from '../src/features/reader/readerResourceBudget.ts';
import {
  removeFailedQaAssistantPlaceholder,
  stripEmptyAssistantMessages,
} from '../src/features/reader/documentReaderQaSessions.ts';
import { resolveReaderQaStreamAbortCleanup } from '../src/features/reader/readerAssistantSidebarProps.ts';
import type { DocumentChatMessage, DocumentChatSession } from '../src/types/reader.ts';

function message(
  id: string,
  role: DocumentChatMessage['role'],
  content: string,
): DocumentChatMessage {
  return { id, role, content, createdAt: 1 };
}

function session(id: string, messages: DocumentChatMessage[] = []): DocumentChatSession {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages };
}

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('a QA-only busy tab stays mounted past the mount limit', () => {
  const readerTabIds = ['reader:a', 'reader:b', 'reader:c'];
  const bridges = {
    'reader:a': { translating: false, qaRunning: true },
    'reader:b': { translating: false, qaRunning: false },
    'reader:c': { translating: false, qaRunning: false },
  };

  const busyTabIds = collectBusyReaderTabIds(readerTabIds, bridges);
  assert.deepEqual(busyTabIds, ['reader:a'], 'only the tab with a running answer is busy');

  const mounted = chooseMountedReaderTabIds({
    readerTabIds,
    activeTabId: 'reader:c',
    recentTabIds: ['reader:c', 'reader:b'],
    busyTabIds,
  });

  // 标签 c 是活动标签，a 因问答在跑保持挂载；b 被挂载上限挡下。
  assert.deepEqual(mounted, ['reader:a', 'reader:c']);
});

test('translating-only tabs still count as busy', () => {
  const busyTabIds = collectBusyReaderTabIds(['reader:a', 'reader:b'], {
    'reader:a': { translating: true, qaRunning: false },
    'reader:b': { translating: false, qaRunning: false },
  });

  assert.deepEqual(busyTabIds, ['reader:a']);

  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['reader:a', 'reader:b', 'reader:c'],
    activeTabId: 'home',
    recentTabIds: ['reader:c'],
    busyTabIds,
  });
  assert.deepEqual(mounted, ['reader:a', 'reader:c']);
});

test('idle tabs and unknown bridge ids are never reported busy', () => {
  const busyTabIds = collectBusyReaderTabIds(['reader:a', 'reader:b'], {
    'reader:a': { translating: false, qaRunning: false },
    // 已关闭标签残留的桥接状态不应影响挂载决策。
    'reader:closed': { translating: true, qaRunning: true },
  });

  assert.deepEqual(busyTabIds, []);
  // 缺少桥接状态（尚未上报）按空闲处理。
  assert.deepEqual(collectBusyReaderTabIds(['reader:a'], {}), []);
});

test('switching tabs in the same workspace does not abort a running answer', () => {
  const hookSource = readSource('src/features/reader/hooks/useReaderQa.ts');
  const effectStart = hookSource.indexOf('const effect_244');
  const effectEnd = hookSource.indexOf('const effect_245');
  assert.ok(effectStart >= 0 && effectEnd > effectStart, 'effect_244 is present');
  const effectBody = hookSource.slice(effectStart, effectEnd);

  // 只有工作区（文档）变化才中止进行中的回答。
  const branchIndex = effectBody.indexOf('if (workspaceChanged)');
  const abortIndex = effectBody.indexOf('controller.abort()');
  assert.ok(branchIndex >= 0 && abortIndex > branchIndex, 'abort only runs inside the workspaceChanged branch');
  const branchBody = effectBody.slice(branchIndex, effectBody.indexOf('\n    }', branchIndex));
  assert.match(branchBody, /controller\.abort\(\)/, 'the abort call belongs to the workspaceChanged branch');
  assert.equal((effectBody.match(/\.abort\(\)/g) ?? []).length, 1, 'no other unconditional abort');

  // effect 只随文档工作区重跑：切换标签只改变 isActive/activeTabId，不会触发它。
  assert.match(effectBody, /\}, \[currentDocument\.workspaceId\]\);/);

  const tabSource = readSource('src/features/reader/DocumentReaderTab.tsx');
  assert.match(tabSource, /useEffect\(qaApi\.effect_244, \[currentDocument\.workspaceId\]\)/);
});

test('abort cleanup removes an empty placeholder and keeps a partial answer', () => {
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: true, sameGeneration: true, streamedAnswer: '' }),
    'remove-placeholder',
  );
  assert.equal(
    resolveReaderQaStreamAbortCleanup({ aborted: true, sameGeneration: true, streamedAnswer: 'partial' }),
    'commit-partial',
  );

  const history = [message('m-user', 'user', 'question')];
  const emptyPlaceholder = message('m-assistant', 'assistant', '');
  const cleaned = removeFailedQaAssistantPlaceholder(
    [session('s-a', [...history, emptyPlaceholder])],
    's-a',
    'm-assistant',
  );
  assert.deepEqual(cleaned[0]?.messages.map((item) => item.id), ['m-user']);

  const partialPlaceholder = message('m-assistant', 'assistant', 'partial answer');
  const partialSessions = [session('s-a', [...history, partialPlaceholder])];
  assert.equal(
    removeFailedQaAssistantPlaceholder(partialSessions, 's-a', 'm-assistant')[0],
    partialSessions[0],
    'a partial answer is never dropped by cleanup',
  );

  // 钩子的 finally 分支把两种清理规则接到会话状态上。
  const hookSource = readSource('src/features/reader/hooks/useReaderQa.ts');
  const submitStart = hookSource.indexOf('const handleSubmitQa');
  const finallyStart = hookSource.indexOf('} finally {', submitStart);
  const finallyEnd = hookSource.indexOf('}, [', finallyStart);
  assert.ok(finallyStart >= 0 && finallyEnd > finallyStart, 'finally block is present');
  const finallyBody = hookSource.slice(finallyStart, finallyEnd);
  assert.match(finallyBody, /resolveReaderQaStreamAbortCleanup\(/);
  assert.match(finallyBody, /commitStreamedAnswer\(streamedAnswer\)/);
  assert.match(finallyBody, /removeFailedQaAssistantPlaceholder\(/);
});

test('empty assistant placeholders are filtered before persistence', () => {
  const sessions = [
    session('s-a', [
      message('m-user', 'user', 'question'),
      message('m-empty', 'assistant', ''),
      message('m-space', 'assistant', '   '),
      message('m-answer', 'assistant', 'answer'),
    ]),
  ];

  assert.deepEqual(
    stripEmptyAssistantMessages(sessions)[0]?.messages.map((item) => item.id),
    ['m-user', 'm-answer'],
  );

  const documentHook = readSource('src/features/reader/hooks/useReaderDocument.ts');
  assert.match(documentHook, /qaSessions: stripEmptyAssistantMessages\(qaSessionsRef\.current\)/);
});

test('the reader bridge reports QA activity for mount budgeting', () => {
  const hookSource = readSource('src/features/reader/hooks/useReaderQa.ts');
  assert.match(hookSource, /const qaRunning = qaRunningSessionIds\.length > 0;/);
  assert.match(hookSource, /qaRunning,/);

  const readerSource = readSource('src/features/reader/Reader.tsx');
  assert.match(
    readerSource,
    /busyTabIds: collectBusyReaderTabIds\(/,
    'Reader derives busy tabs from the shared helper',
  );
  assert.match(
    readerSource,
    /left\.qaRunning === right\.qaRunning/,
    'bridge equality must compare qaRunning or the busy update is dropped',
  );
});
