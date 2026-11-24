import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('app-level settings live under src/app/settings and are mounted by App', () => {
  for (const relativePath of [
    'src/app/settings/AppSettingsWindow.tsx',
    'src/app/settings/BackupTransferSection.tsx',
    'src/app/settings/BackupPasswordDialog.tsx',
    'src/app/settings/BackupProgressPanel.tsx',
    'src/app/settings/McpSettingsSection.tsx',
    'src/app/settings/UpdateSettingsSection.tsx',
    'src/app/settings/settingsPrimitives.tsx',
    'src/app/settings/settingsTypes.ts',
    'src/app/settings/useAppSettingsStore.ts',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
  }

  for (const removed of [
    'src/features/reader/BackupTransferSection.tsx',
    'src/features/reader/BackupPasswordDialog.tsx',
    'src/features/reader/BackupProgressPanel.tsx',
    'src/features/reader/readerPreferencesMcpSection.tsx',
    'src/features/reader/readerPreferencesUpdateSection.tsx',
    'src/features/reader/readerPreferencesPrimitives.tsx',
  ]) {
    assert.equal(existsSync(path.join(root, removed)), false, `${removed} must be moved out of features/reader`);
  }

  const app = read('src/app/App.tsx');
  assert.match(app, /<AppSettingsWindow\s*\/>/);
  assert.match(app, /openSettings\('general'\)/);
  assert.match(app, /activeWorkspace === 'library'/);
});

test('Reader preferences reuse the app-level sections instead of owning them', () => {
  const content = read('src/features/reader/readerPreferencesContent.tsx');
  assert.match(content, /from '\.\.\/\.\.\/app\/settings\/BackupTransferSection'/);
  assert.match(content, /from '\.\.\/\.\.\/app\/settings\/McpSettingsSection'/);
  assert.match(content, /from '\.\.\/\.\.\/app\/settings\/UpdateSettingsSection'/);
  assert.match(content, /from '\.\.\/\.\.\/app\/settings\/settingsPrimitives'/);
});

test('settings writes no longer go straight to localStorage or the renderer config writer', () => {
  const hook = read('src/features/reader/useReaderSettings.ts');
  assert.equal(/localStorage\.setItem\(SETTINGS_STORAGE_KEY/.test(hook), false);
  assert.equal(/writeReaderConfigFile/.test(hook), false);
  assert.match(hook, /patchAppSettingsAndSync/);
  assert.match(hook, /migrateLegacyAppSettings/);

  const bibliography = read('src/features/notes/bibliography.ts');
  assert.equal(/localStorage\.setItem\(/.test(bibliography), false);
  assert.match(bibliography, /patchAppSettingsAndSync/);
});

test('Zotero data dir is written through the app settings store, not double-written by the renderer', () => {
  const hook = read('src/features/reader/useReaderSettings.ts');
  assert.match(hook, /patchZoteroLocalDataDirAndSync/);
  assert.equal(/zoteroLocalDataDir,[\s\S]{0,80}CONFIG_WRITE_DEBOUNCE_MS/.test(hook), false);

  const reader = read('src/features/reader/Reader.tsx');
  assert.equal(/reader-zotero-input/.test(reader), false, 'the 500ms Zotero double-write effect must be gone');

  const commands = read('electron/backend/libraryCommands.cjs');
  assert.match(commands, /appSettings\.patchZoteroDir/);
  assert.match(commands, /withCanonicalZoteroDir/);

  const database = read('electron/backend/libraryDatabaseStore.cjs');
  assert.match(database, /ON CONFLICT\(key\) DO UPDATE SET value_json = excluded\.value_json/);
  assert.equal(/saveKeyValueTable\(db, tableName, values\) \{\n {2}db\.prepare\(`DELETE FROM \$\{tableName\}`\)\.run\(\);/.test(database), false);
});
