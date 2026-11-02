import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatShortcut,
  listCommands,
  parseShortcut,
  registerCommands,
  runCommand,
} from '../src/ui/commands.ts';

test('parseShortcut splits modifiers and key', () => {
  assert.deepEqual(parseShortcut('mod+k'), { key: 'k', mod: true, shift: false, alt: false });
  assert.deepEqual(parseShortcut('Ctrl+Shift+P'), { key: 'p', mod: true, shift: true, alt: false });
  assert.deepEqual(parseShortcut('mod+,'), { key: ',', mod: true, shift: false, alt: false });
  assert.deepEqual(parseShortcut('alt+ArrowUp'), { key: 'arrowup', mod: false, shift: false, alt: true });
});

test('formatShortcut renders platform-specific text', () => {
  const formatted = formatShortcut('mod+k');

  // 无 window 环境按 Windows 处理，输出 Ctrl+K。
  assert.equal(formatted, 'Ctrl+K');
  assert.equal(formatShortcut('mod+,'), 'Ctrl+,');
});

test('registerCommands adds commands and returns an idempotent unregister', async () => {
  let calls = 0;
  const command = {
    id: 'test.only-once',
    title: 'Test command',
    run: () => {
      calls += 1;
    },
  };

  const unregister = registerCommands([command]);
  assert.ok(listCommands().some((item) => item.id === 'test.only-once'));

  await runCommand('test.only-once');
  assert.equal(calls, 1);

  // 重复注册同一 id 会覆盖，不会产生两条。
  const second = { ...command, title: 'Overridden', run: () => { calls += 10; } };
  const unregisterSecond = registerCommands([second]);
  assert.equal(listCommands().filter((item) => item.id === 'test.only-once').length, 1);
  await runCommand('test.only-once');
  assert.equal(calls, 11);

  // 旧注册的清理不应移除后注册的那条。
  unregister();
  assert.ok(listCommands().some((item) => item.id === 'test.only-once'));

  unregisterSecond();
  assert.equal(listCommands().some((item) => item.id === 'test.only-once'), false);
});

test('runCommand on unknown id resolves without throwing', async () => {
  await assert.doesNotReject(() => runCommand('test.does-not-exist'));
});
