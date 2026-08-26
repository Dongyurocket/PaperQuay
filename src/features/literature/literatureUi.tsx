import { Database, Folder, FolderOpen, Star } from 'lucide-react';
import type {
  LiteratureCategory,
  LiteraturePaper,
} from '../../types/library';
import type { UiLanguage } from '../../types/reader';
import { paperPdfPath as resolveLibraryPaperPdfPath } from '../../utils/libraryPaper';
import {
  resolvePaperTranslatedPdfAttachment,
  type ResolvedPaperPdfAttachment,
} from '../../utils/libraryPaper';

export interface FlatLiteratureCategory extends LiteratureCategory {
  depth: number;
}

export function flattenCategories(categories: LiteratureCategory[]): FlatLiteratureCategory[] {
  const systemCategories = categories
    .filter((category) => category.isSystem)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const userCategories = categories
    .filter((category) => !category.isSystem)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const childrenMap = new Map<string | null, LiteratureCategory[]>();

  for (const category of userCategories) {
    const parentId = category.parentId ?? null;
    childrenMap.set(parentId, [...(childrenMap.get(parentId) ?? []), category]);
  }

  const output: FlatLiteratureCategory[] = systemCategories.map((category) => ({
    ...category,
    depth: 0,
  }));
  const visited = new Set<string>();

  const visit = (parentId: string | null, depth: number) => {
    for (const category of childrenMap.get(parentId) ?? []) {
      if (visited.has(category.id)) {
        continue;
      }

      visited.add(category.id);
      output.push({
        ...category,
        depth,
      });
      visit(category.id, depth + 1);
    }
  };

  visit(null, 0);

  return output;
}

export function categoryIcon(category: LiteratureCategory) {
  if (category.systemKey === 'favorites') {
    return <Star className="h-4 w-4" strokeWidth={1.8} />;
  }

  if (category.isSystem) {
    return <Database className="h-4 w-4" strokeWidth={1.8} />;
  }

  return category.parentId ? (
    <Folder className="h-4 w-4" strokeWidth={1.8} />
  ) : (
    <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
  );
}

export function categoryDisplayName(category: LiteratureCategory, locale: UiLanguage): string {
  switch (category.systemKey) {
    case 'all':
      return locale === 'en-US' ? 'All Papers' : '所有文献';
    case 'recent':
      return locale === 'en-US' ? 'Recently Imported' : '最近导入';
    case 'uncategorized':
      return locale === 'en-US' ? 'Uncategorized' : '未分类';
    case 'favorites':
      return locale === 'en-US' ? 'Favorites' : '收藏';
    default:
      return category.name;
  }
}

export function paperAuthors(paper: LiteraturePaper, locale: UiLanguage = 'zh-CN'): string {
  if (paper.authors.length === 0) {
    return locale === 'en-US' ? 'Unknown Authors' : '未知作者';
  }

  return paper.authors.map((author) => author.name).join(', ');
}

export function paperPdfPath(paper: LiteraturePaper, storageDir?: string | null): string | null {
  return resolveLibraryPaperPdfPath(paper, { storageDir });
}

export function paperTranslatedPdfAttachment(
  paper: LiteraturePaper,
  storageDir?: string | null,
): ResolvedPaperPdfAttachment | null {
  return resolvePaperTranslatedPdfAttachment(paper, { storageDir });
}
