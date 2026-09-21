export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  paddingStart: number;
  paddingEnd: number;
  totalSize: number;
}

export function resolveVirtualWindow(options: {
  itemCount: number;
  getItemSize: (index: number) => number;
  scrollOffset: number;
  viewportSize: number;
  overscan?: number;
}): VirtualWindow {
  const itemCount = Math.max(0, Math.floor(options.itemCount));
  const overscan = Math.max(0, Math.floor(options.overscan ?? 0));
  const scrollOffset = Math.max(0, options.scrollOffset);
  const viewportSize = Math.max(0, options.viewportSize);

  if (itemCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      paddingStart: 0,
      paddingEnd: 0,
      totalSize: 0,
    };
  }

  const sizes = new Array<number>(itemCount);
  let totalSize = 0;

  for (let index = 0; index < itemCount; index += 1) {
    const size = Math.max(0, options.getItemSize(index));
    sizes[index] = size;
    totalSize += size;
  }

  const viewportStart = scrollOffset;
  const viewportEnd = scrollOffset + viewportSize;

  let startIndex = 0;
  let offset = 0;

  while (startIndex < itemCount && offset + (sizes[startIndex] ?? 0) < viewportStart) {
    offset += sizes[startIndex] ?? 0;
    startIndex += 1;
  }

  let endIndex = startIndex;
  let endOffset = offset;

  while (endIndex < itemCount && endOffset < viewportEnd) {
    endOffset += sizes[endIndex] ?? 0;
    endIndex += 1;
  }

  startIndex = Math.max(0, startIndex - overscan);
  endIndex = Math.min(itemCount, endIndex + overscan);

  let paddingStart = 0;

  for (let index = 0; index < startIndex; index += 1) {
    paddingStart += sizes[index] ?? 0;
  }

  let renderedSize = 0;

  for (let index = startIndex; index < endIndex; index += 1) {
    renderedSize += sizes[index] ?? 0;
  }

  return {
    startIndex,
    endIndex,
    paddingStart,
    paddingEnd: Math.max(0, totalSize - paddingStart - renderedSize),
    totalSize,
  };
}

export function getVirtualOffset(
  index: number,
  getItemSize: (index: number) => number,
): number {
  const safeIndex = Math.max(0, Math.floor(index));
  let offset = 0;

  for (let current = 0; current < safeIndex; current += 1) {
    offset += Math.max(0, getItemSize(current));
  }

  return offset;
}

export function areVirtualWindowsEqual(left: VirtualWindow, right: VirtualWindow): boolean {
  return (
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex &&
    left.paddingStart === right.paddingStart &&
    left.paddingEnd === right.paddingEnd &&
    left.totalSize === right.totalSize
  );
}
