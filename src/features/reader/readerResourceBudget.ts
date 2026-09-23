export const READER_MOUNTED_TAB_LIMIT = 2;

export function chooseMountedReaderTabIds(input: {
  readerTabIds: readonly string[];
  activeTabId: string;
  recentTabIds?: readonly string[];
  busyTabIds?: readonly string[];
}): string[] {
  const readerIds = input.readerTabIds.filter((id) => id.trim());
  const reader = new Set(readerIds);
  const mounted = new Set<string>();

  if (reader.has(input.activeTabId)) {
    mounted.add(input.activeTabId);
  }

  for (const id of input.busyTabIds ?? []) {
    if (reader.has(id)) {
      mounted.add(id);
    }
  }

  for (const id of [...(input.recentTabIds ?? []), ...readerIds]) {
    if (!reader.has(id) || mounted.has(id)) {
      continue;
    }

    if (mounted.size >= READER_MOUNTED_TAB_LIMIT) {
      break;
    }

    mounted.add(id);
  }

  return readerIds.filter((id) => mounted.has(id));
}
