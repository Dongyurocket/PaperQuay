'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('./nodeSqlite.cjs');

const LEGACY_BACKUP_TABLE = ['web', 'dav_settings'].join('');
const LEGACY_BACKUP_SETTING = 'backupEnabled';

function cleanupLegacyBackupSettings(databasePath) {
  if (typeof databasePath !== 'string' || !databasePath || !fs.existsSync(databasePath)) {
    return { droppedTable: false, removedSettings: 0 };
  }
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  let droppedTable = false;
  let removedSettings = 0;
  try {
    db.exec('BEGIN IMMEDIATE');
    const hasTable = Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(LEGACY_BACKUP_TABLE));
    if (hasTable) {
      db.exec(`DROP TABLE IF EXISTS "${LEGACY_BACKUP_TABLE}"`);
      droppedTable = true;
    }
    const hasSettings = Boolean(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'library_settings'",
    ).get());
    if (hasSettings) {
      const result = db.prepare('DELETE FROM library_settings WHERE key = ?').run(LEGACY_BACKUP_SETTING);
      removedSettings = Number(result.changes) || 0;
    }
    db.exec('COMMIT');
    return { droppedTable, removedSettings };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

module.exports = { cleanupLegacyBackupSettings };
