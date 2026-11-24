import type { ZoteroLibraryItem } from '../../types/reader';
import { zoteroItemIdentity } from '../../shared/zoteroItemMetadata.cjs';

export function zoteroItemImportIdentity(item: ZoteroLibraryItem): string {
  return zoteroItemIdentity(item);
}

export function uniqueZoteroItems(items: ZoteroLibraryItem[]): ZoteroLibraryItem[] {
  const seen = new Set<string>();
  const output: ZoteroLibraryItem[] = [];

  for (const item of items) {
    const identity = zoteroItemImportIdentity(item);
    if (!identity || seen.has(identity)) continue;

    seen.add(identity);
    output.push(item);
  }

  return output;
}

export function filterZoteroItemsOutsideCollections(
  allItems: ZoteroLibraryItem[],
  collectionItems: ZoteroLibraryItem[],
): ZoteroLibraryItem[] {
  const filed = new Set(collectionItems.map(zoteroItemImportIdentity).filter(Boolean));

  return uniqueZoteroItems(allItems).filter((item) => {
    const identity = zoteroItemImportIdentity(item);
    return identity && !filed.has(identity);
  });
}
