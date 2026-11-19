const fs = require('node:fs');
const path = require('node:path');

/**
 * 独立 Agent 退役后的一次性清理（幂等）。
 *
 * 删除：
 * - `agent-memory` 目录（长期记忆与运行 trace 副本）
 * - RAG 数据库里的 agent_runs / agent_run_events 行（表结构保留）
 *
 * 结果写入版本化标记，供启动日志与诊断查看清理数量；再次运行不再删除任何内容。
 * 旧 `.pqbackup` 文件保持原样；恢复时由 backupImport 在暂存阶段过滤。
 */
const CLEANUP_MARKER_FILE = 'agent-retired-cleanup-v1.json';

function cleanupMarkerPath(appPaths) {
  return path.join(appPaths.dataDir, '.settings', CLEANUP_MARKER_FILE);
}

function readCleanupMarker(appPaths) {
  try {
    const raw = fs.readFileSync(cleanupMarkerPath(appPaths), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCleanupMarker(appPaths, summary) {
  const filePath = cleanupMarkerPath(appPaths);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function cleanupRetiredAgentData(appPaths, { ragStore } = {}) {
  const existing = readCleanupMarker(appPaths);

  if (existing) {
    return { alreadyDone: true, ...existing, removed: null };
  }

  const memoryDir = path.join(appPaths.dataDir, 'agent-memory');
  let memoryFilesRemoved = 0;

  try {
    if (fs.existsSync(memoryDir)) {
      const countFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .reduce((count, entry) => count + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1), 0);
      memoryFilesRemoved = countFiles(memoryDir);
      fs.rmSync(memoryDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('[paperquay] Failed to remove the retired agent-memory directory.', error);
  }

  let runsRemoved = 0;
  let eventsRemoved = 0;

  try {
    if (typeof ragStore?.clearAgentHistory === 'function') {
      const cleared = ragStore.clearAgentHistory();
      runsRemoved = Number(cleared?.runs) || 0;
      eventsRemoved = Number(cleared?.events) || 0;
    }
  } catch (error) {
    console.warn('[paperquay] Failed to clear retired agent run history.', error);
  }

  const summary = {
    version: 1,
    cleanedAt: new Date().toISOString(),
    memoryFilesRemoved,
    runsRemoved,
    eventsRemoved,
  };

  try {
    writeCleanupMarker(appPaths, summary);
  } catch (error) {
    console.warn('[paperquay] Failed to persist the agent cleanup marker.', error);
  }

  return { alreadyDone: false, ...summary, removed: summary };
}

module.exports = {
  CLEANUP_MARKER_FILE,
  cleanupMarkerPath,
  cleanupRetiredAgentData,
  readCleanupMarker,
};
