import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReaderImmersiveCommand,
  getReaderImmersiveVisibility,
  READER_IMMERSIVE_COMMAND_ID,
  READER_IMMERSIVE_SHORTCUT,
} from '../src/features/reader/readerImmersive.ts';
import { parseShortcut } from '../src/ui/commands.ts';

test('reader immersive visibility leaves only the exit control', () => {
  assert.deepEqual(getReaderImmersiveVisibility(true), {
    showHeader: false,
    showPaneToolbars: false,
    showExitControl: true,
  });
  assert.deepEqual(getReaderImmersiveVisibility(false), {
    showHeader: true,
    showPaneToolbars: true,
    showExitControl: false,
  });
});

test('reader immersive command uses an available shift shortcut without colliding with reader commands', () => {
  let toggled = 0;
  const command = buildReaderImmersiveCommand({
    available: true,
    localize: (zh, en) => `${zh}/${en}`,
    onToggle: () => { toggled += 1; },
  });

  assert.equal(command.id, READER_IMMERSIVE_COMMAND_ID);
  assert.equal(command.shortcut, READER_IMMERSIVE_SHORTCUT);
  assert.deepEqual(parseShortcut(command.shortcut ?? ''), {
    key: 'f',
    mod: true,
    shift: true,
    alt: false,
  });
  assert.notEqual(command.shortcut, 'mod+f');
  assert.notEqual(command.shortcut, 'mod+k');
  assert.equal(command.isAvailable?.(), true);
  void command.run();
  assert.equal(toggled, 1);
});

