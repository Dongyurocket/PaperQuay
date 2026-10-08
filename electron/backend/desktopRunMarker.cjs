const fs = require('node:fs');
const path = require('node:path');

const MARKER_FILE = '.paperquay-desktop-running.json';
const MARKER_VERSION = 1;

function markerPath(dataDir) {
  return path.join(dataDir, MARKER_FILE);
}

function isValidPid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function processState(pid) {
  if (!isValidPid(pid)) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'running';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'stopped';
    if (error?.code === 'EPERM') return 'running';
    return 'unknown';
  }
}

function normalizeEntry(value) {
  const pid = Number(value?.pid);
  if (!isValidPid(pid)) return null;

  return {
    pid,
    startedAt: Number.isSafeInteger(Number(value?.startedAt)) && Number(value.startedAt) > 0
      ? Number(value.startedAt)
      : null,
  };
}

function readDesktopRunMarker(dataDir) {
  const filePath = markerPath(dataDir);
  let raw;

  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { status: 'missing', filePath, raw: '', entries: [] };
    }
    return { status: 'unknown', filePath, raw: '', entries: [] };
  }

  try {
    const payload = JSON.parse(raw);
    const sourceEntries = Array.isArray(payload?.instances)
      ? payload.instances
      : payload?.pid !== undefined
        ? [payload]
        : null;

    if (!sourceEntries) {
      return { status: 'unknown', filePath, raw, entries: [] };
    }

    const entries = [];
    const seenPids = new Set();
    for (const value of sourceEntries) {
      const entry = normalizeEntry(value);
      if (!entry) {
        return { status: 'unknown', filePath, raw, entries: [] };
      }
      if (!seenPids.has(entry.pid)) {
        seenPids.add(entry.pid);
        entries.push(entry);
      }
    }

    return { status: 'known', filePath, raw, entries };
  } catch {
    return { status: 'unknown', filePath, raw, entries: [] };
  }
}

function writeMarkerPayload(filePath, entries) {
  const payload = JSON.stringify({
    version: MARKER_VERSION,
    updatedAt: Date.now(),
    instances: entries,
  });
  const temporaryPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function liveEntries(entries) {
  const output = [];

  for (const entry of entries) {
    const state = processState(entry.pid);
    if (state !== 'stopped') {
      output.push(entry);
    }
  }

  return output;
}

function writeDesktopRunMarker(dataDir, pid = process.pid) {
  if (!isValidPid(pid)) {
    throw new Error('Desktop run marker requires a valid PID.');
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const current = readDesktopRunMarker(dataDir);
  const entries = current.status === 'known' ? liveEntries(current.entries) : [];
  const existingIndex = entries.findIndex((entry) => entry.pid === pid);
  const nextEntry = { pid, startedAt: Date.now() };

  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry;
  } else {
    entries.push(nextEntry);
  }

  writeMarkerPayload(current.filePath, entries);
  return current.filePath;
}

function removeDesktopRunMarker(dataDir, pid = process.pid) {
  if (!isValidPid(pid)) return false;

  const current = readDesktopRunMarker(dataDir);
  if (current.status !== 'known') {
    return false;
  }

  const ownsMarker = current.entries.some((entry) => entry.pid === pid);
  if (!ownsMarker) {
    return false;
  }

  const remainingEntries = liveEntries(current.entries.filter((entry) => entry.pid !== pid));
  if (remainingEntries.length > 0) {
    writeMarkerPayload(current.filePath, remainingEntries);
    return true;
  }

  // Only remove a marker that identifies this process as an owner. The marker is
  // advisory run state, not a cross-process lock; do not delete unknown state.
  try {
    fs.unlinkSync(current.filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function desktopRunMarkerState(dataDir) {
  const current = readDesktopRunMarker(dataDir);
  if (current.status === 'missing') return false;
  if (current.status !== 'known') return null;

  let hasUnknownProcessState = false;
  for (const entry of current.entries) {
    const state = processState(entry.pid);
    if (state === 'running') return true;
    if (state === 'unknown') hasUnknownProcessState = true;
  }

  return hasUnknownProcessState ? null : false;
}

function isDesktopRunMarkerActive(dataDir) {
  return desktopRunMarkerState(dataDir) === true;
}

module.exports = {
  desktopRunMarkerState,
  isDesktopRunMarkerActive,
  markerPath,
  removeDesktopRunMarker,
  writeDesktopRunMarker,
};
