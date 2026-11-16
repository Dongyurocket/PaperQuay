import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, FileText, FolderOpen, Languages, FileType } from 'lucide-react';
import type { LiteraturePaper } from '../../types/library';
import { localPathsExist, revealLocalPath } from '../../services/desktop';
import { copyTextToClipboard } from '../../utils/clipboard';
import type { MenuEntry } from '../../ui/menu';
import { toast } from '../../ui/toast';
import {
  resolvePaperFileLocationsOnDisk,
  type PaperFileLocationOptions,
  type ResolvedPaperFileLocation,
} from './paperFileLocations';

type LocaleText = (zh: string, en: string) => string;

interface UsePaperFileLocationMenuOptions extends PaperFileLocationOptions {
  /** 右键菜单当前针对的文献；菜单关闭时为 null。 */
  paper: LiteraturePaper | null;
  l: LocaleText;
}

interface LocationState {
  paperId: string;
  locations: ResolvedPaperFileLocation[];
}

const ICON_CLASS = 'h-4 w-4 text-[var(--pq-text-muted)]';

/**
 * 文献右键菜单的「打开所在位置」分组。
 * 菜单打开时一次性检查各候选路径是否存在：检查期间与不存在的项置灰。
 */
export function usePaperFileLocationMenu({
  paper,
  storageDir,
  mineruCacheDir,
  autoLoadSiblingJson,
  l,
}: UsePaperFileLocationMenuOptions): MenuEntry[] {
  const [state, setState] = useState<LocationState | null>(null);

  useEffect(() => {
    if (!paper) {
      setState(null);
      return;
    }

    let cancelled = false;
    setState(null);

    void resolvePaperFileLocationsOnDisk(
      paper,
      { storageDir, mineruCacheDir, autoLoadSiblingJson },
      localPathsExist,
    )
      .then((locations) => {
        if (!cancelled) {
          setState({ paperId: paper.id, locations });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ paperId: paper.id, locations: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [autoLoadSiblingJson, mineruCacheDir, paper, storageDir]);

  return useMemo(() => {
    if (!paper) {
      return [];
    }

    const ready = state?.paperId === paper.id;
    const locations = ready ? state.locations : [];
    const find = (id: string) => locations.find((location) => location.id === id) ?? null;

    const suffix = (location: ResolvedPaperFileLocation | null) => {
      if (!ready) return l('（检查中…）', ' (checking…)');
      return location?.path ? '' : l('（未找到）', ' (not found)');
    };

    const reveal = async (path: string) => {
      try {
        const result = await revealLocalPath(path);
        if (!result.ok) {
          toast({
            tone: 'error',
            message: result.reason === 'missing'
              ? l('文件已不存在', 'The file no longer exists')
              : l('无法打开所在位置', 'Could not open the location'),
            description: result.reason === 'missing' ? path : result.message,
          });
        }
      } catch (error) {
        toast({
          tone: 'error',
          message: l('无法打开所在位置', 'Could not open the location'),
          description: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const revealItem = (
      id: string,
      location: ResolvedPaperFileLocation | null,
      label: string,
      icon: ReactNode,
    ): MenuEntry => ({
      id,
      label: `${label}${suffix(location)}`,
      icon,
      disabled: !location?.path,
      onSelect: () => {
        if (location?.path) {
          void reveal(location.path);
        }
      },
    });

    const pdf = find('pdf');
    const translated = locations.filter((location) => location.kind === 'translated-pdf');
    const entries: MenuEntry[] = [
      { type: 'separator', id: 'file-locations-separator' },
      revealItem(
        'reveal-pdf',
        pdf,
        l('在文件夹中显示 PDF', 'Show PDF in Folder'),
        <FileText className={ICON_CLASS} strokeWidth={1.9} />,
      ),
    ];

    for (const location of translated) {
      entries.push(revealItem(
        `reveal-${location.id}`,
        location,
        location.language
          ? l(`在文件夹中显示译版 PDF（${location.language}）`, `Show Translated PDF (${location.language}) in Folder`)
          : l('在文件夹中显示译版 PDF', 'Show Translated PDF in Folder'),
        <Languages className={ICON_CLASS} strokeWidth={1.9} />,
      ));
    }

    entries.push(
      revealItem(
        'open-mineru-dir',
        find('mineru-dir'),
        l('打开 MinerU 结果文件夹', 'Open MinerU Output Folder'),
        <FolderOpen className={ICON_CLASS} strokeWidth={1.9} />,
      ),
      revealItem(
        'reveal-markdown',
        find('markdown'),
        l('在文件夹中显示 Markdown', 'Show Markdown in Folder'),
        <FileType className={ICON_CLASS} strokeWidth={1.9} />,
      ),
      {
        id: 'copy-pdf-path',
        label: `${l('复制 PDF 路径', 'Copy PDF Path')}${suffix(pdf)}`,
        icon: <Copy className={ICON_CLASS} strokeWidth={1.9} />,
        disabled: !pdf?.path,
        onSelect: async () => {
          if (!pdf?.path) return;
          const copied = await copyTextToClipboard(pdf.path);
          toast(copied
            ? { tone: 'success', message: l('已复制 PDF 路径', 'PDF path copied') }
            : { tone: 'error', message: l('复制失败', 'Copy failed') });
        },
      },
    );

    return entries;
  }, [l, paper, state]);
}
