import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookOpenText, Check, ChevronDown, Copy, ExternalLink, FileText, Languages,
  MoreHorizontal, Pencil, Save, Star, Trash2, X,
} from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import type {
  LibraryTagCount, LiteratureCategory, LiteraturePaper, LiteraturePaperTaskState,
  UpdatePaperRequest,
} from '../../../types/library';
import type { PdfReadingHeatmap } from '../../../types/reader';
import { loadPaperHistory, PAPER_READING_HEATMAP_UPDATED_EVENT } from '../../../utils/paperHistory';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { paperToBibtexEntry } from '../../../utils/bibtex';
import { formatBibliographyEntry } from '../../notes/bibliography';
import { normalizeOrcid } from '../metadataValidation';
import { paperPdfPath, paperTranslatedPdfAttachment } from '../literatureUi';
import { resolvePaperTitleDisplay, type PaperTitleDisplayMode } from '../titleDisplay';
import type { LiteraturePaperListStatus, LiteraturePaperRagStatus } from './LiteraturePaperList';
import { getPaperTaskProgress } from '../paperTaskProgress';
import { loadPaperDetailsSections, persistPaperDetailsSections, type PaperDetailsSectionKey, type PaperDetailsSectionState } from '../details/paperDetailsSections';
import { parsePaperOverviewForDisplay } from '../details/paperOverviewPresentation';
import { buildPaperDraftUpdateRequest, createPaperDetailsDraft, hasDuplicateCitationKey, paperDraftChanged, validatePaperDraft, normalizeDoi, type PaperDetailsDraft, type PaperDraftErrors } from '../details/paperDetailsDraft';
import PaperEditForm from '../details/PaperEditForm';
import PaperDetailsStatusBar from '../details/PaperDetailsStatusBar';
import MetadataRecognitionDialog from '../details/MetadataRecognitionDialog';
import { usePaperFileLocationMenu } from '../usePaperFileLocationMenu';
import LiteratureReadingTimeChart from './LiteratureReadingTimeChart';
import TranslatedPdfLanguageDialog from './TranslatedPdfLanguageDialog';
import { ConfirmDialog, Dialog } from '../../../ui/dialog';
import { Menu, type MenuEntry } from '../../../ui/menu';
import { toast } from '../../../ui/toast';

interface LiteraturePaperDetailsProps {
  selectedPaper: LiteraturePaper | null;
  titleDisplayMode: PaperTitleDisplayMode;
  saving: boolean;
  categories: LiteratureCategory[];
  libraryTags: LibraryTagCount[];
  allPapers: LiteraturePaper[];
  paperStatus?: LiteraturePaperListStatus;
  storageDir?: string | null;
  mineruCacheDir?: string;
  autoLoadSiblingJson?: boolean;
  onOpenPaper: (paper: LiteraturePaper) => void;
  onSavePaper: (request: UpdatePaperRequest, categoryIds?: string[]) => Promise<LiteraturePaper | void>;
  onRestorePaperSelection: (paperId: string | null) => void;
  actionState?: LiteraturePaperTaskState | null;
  onRunMineruParse?: (paper: LiteraturePaper) => void;
  onTranslatePaper?: (paper: LiteraturePaper) => void;
  onTranslatePaperTitle?: (paper: LiteraturePaper) => Promise<string | null>;
  onAttachTranslatedPdf?: (paper: LiteraturePaper) => void;
  onRemoveTranslatedPdf?: (paper: LiteraturePaper) => void;
  onUpdateTranslatedPdfLanguage?: (paper: LiteraturePaper, attachmentId: string, language: string | null) => Promise<void>;
  onGenerateSummary?: (paper: LiteraturePaper) => void;
  ragStatus?: LiteraturePaperRagStatus;
  ragMembershipBusy?: boolean;
  onSetRagMembership?: (paper: LiteraturePaper, enabled: boolean) => void;
  onIndexPaperRag?: (paper: LiteraturePaper) => void;
  onDeletePaper?: (paper: LiteraturePaper) => void;
}

type InlineFieldKey = 'title' | 'year' | 'doi';
interface MenuPosition { x: number; y: number; anchor: HTMLButtonElement; entries: MenuEntry[] }

function getLatestHeatmap(paperId: string): PdfReadingHeatmap | null {
  const history = loadPaperHistory(`native-library:${paperId}`);
  return Object.values(history?.pdfReadingHeatmaps ?? {})
    .filter((heatmap) => heatmap.totalMs > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

function DetailsSection({
  title, collapsed, onToggle, children,
}: { title: string; collapsed: boolean; onToggle: () => void; children: ReactNode }) {
  const l = useLocaleText();
  return (
    <section className="border-b border-[var(--pq-border-subtle)] py-2 last:border-b-0">
      <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="flex w-full items-center justify-between gap-3 py-1 text-left text-sm font-semibold text-[var(--pq-text)]">
        <span>{title}</span>
        <ChevronDown className={['h-4 w-4 shrink-0 text-[var(--pq-text-faint)] transition-transform', collapsed ? '-rotate-90' : ''].join(' ')} />
        <span className="sr-only">{collapsed ? l('展开', 'Expand') : l('折叠', 'Collapse')}</span>
      </button>
      {!collapsed ? <div className="pb-2 pt-2">{children}</div> : null}
    </section>
  );
}

function InlineEditor({
  label, value, active, draftValue, error, onBegin, onChange, onCommit, onCancel,
}: {
  label: string;
  value: string;
  active: boolean;
  draftValue: string;
  error?: string;
  onBegin: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const l = useLocaleText();
  if (active) {
    return (
      <label className="min-w-0">
        <span className="sr-only">{label}</span>
        <input autoFocus value={draftValue} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        }} className="pq-input h-8 w-full px-2 text-sm" />
        {error ? <span className="mt-1 block text-xs text-[var(--pq-danger)]">{error}</span> : null}
        <span className="sr-only">{l('按 Enter 保存，按 Esc 取消', 'Press Enter to save or Esc to cancel')}</span>
      </label>
    );
  }
  return (
    <button type="button" onClick={onBegin} title={l(`编辑${label}`, `Edit ${label}`)} className="group inline-flex max-w-full items-center gap-1 text-left hover:text-[var(--pq-accent)]">
      <span className="truncate">{value || l('未设置', 'Not set')}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-70" />
    </button>
  );
}

export default function LiteraturePaperDetails({
  selectedPaper,
  titleDisplayMode,
  saving,
  categories,
  libraryTags,
  allPapers,
  paperStatus,
  storageDir,
  mineruCacheDir = '',
  autoLoadSiblingJson = true,
  onOpenPaper,
  onSavePaper,
  onRestorePaperSelection,
  actionState = null,
  onRunMineruParse,
  onTranslatePaper,
  onTranslatePaperTitle,
  onAttachTranslatedPdf,
  onRemoveTranslatedPdf,
  onUpdateTranslatedPdfLanguage,
  onGenerateSummary,
  ragStatus = 'none',
  ragMembershipBusy = false,
  onSetRagMembership,
  onIndexPaperRag,
  onDeletePaper,
}: LiteraturePaperDetailsProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [paper, setPaper] = useState(selectedPaper);
  const [draft, setDraft] = useState<PaperDetailsDraft | null>(() => selectedPaper ? createPaperDetailsDraft(selectedPaper) : null);
  const [draftErrors, setDraftErrors] = useState<PaperDraftErrors>({});
  const [editing, setEditing] = useState(false);
  const [pendingPaper, setPendingPaper] = useState<LiteraturePaper | null>(null);
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [excludeConfirmOpen, setExcludeConfirmOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuPosition | null>(null);
  const [inlineField, setInlineField] = useState<InlineFieldKey | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const [inlineError, setInlineError] = useState('');
  const [sections, setSections] = useState<PaperDetailsSectionState>(loadPaperDetailsSections);
  const [readingHeatmap, setReadingHeatmap] = useState<PdfReadingHeatmap | null>(() => selectedPaper ? getLatestHeatmap(selectedPaper.id) : null);
  const paperRef = useRef(paper);
  const draftRef = useRef(draft);
  const editingRef = useRef(editing);
  paperRef.current = paper;
  draftRef.current = draft;
  editingRef.current = editing;

  useEffect(() => persistPaperDetailsSections(sections), [sections]);
  useEffect(() => {
    const currentPaper = paperRef.current;
    const currentDraft = draftRef.current;

    if (selectedPaper?.id === currentPaper?.id) {
      if (selectedPaper && currentPaper !== selectedPaper) {
        setPaper(selectedPaper);
        if (!currentPaper || !currentDraft || !paperDraftChanged(currentPaper, currentDraft)) {
          setDraft(createPaperDetailsDraft(selectedPaper));
          setDraftErrors({});
        }
      }
      return;
    }

    if (currentPaper && currentDraft && editingRef.current && paperDraftChanged(currentPaper, currentDraft)) {
      setPendingPaper(selectedPaper);
      setSwitchDialogOpen(true);
      return;
    }
    setPaper(selectedPaper);
    setDraft(selectedPaper ? createPaperDetailsDraft(selectedPaper) : null);
    setDraftErrors({});
    setEditing(false);
    setPendingPaper(null);
    setInlineField(null);
    setReadingHeatmap(selectedPaper ? getLatestHeatmap(selectedPaper.id) : null);
  }, [selectedPaper]);

  useEffect(() => {
    const handleHeatmap = () => { if (paper) setReadingHeatmap(getLatestHeatmap(paper.id)); };
    window.addEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, handleHeatmap);
    return () => window.removeEventListener(PAPER_READING_HEATMAP_UPDATED_EVENT, handleHeatmap);
  }, [paper?.id]);

  const toggleSection = (key: PaperDetailsSectionKey) => setSections((current) => ({ ...current, [key]: !current[key] }));
  const translatedPdf = paper ? paperTranslatedPdfAttachment(paper, storageDir) : null;
  const fileLocationEntries = usePaperFileLocationMenu({ paper, storageDir, mineruCacheDir, autoLoadSiblingJson, l });
  const overviewSections = useMemo(() => paper ? parsePaperOverviewForDisplay(paper.aiSummary ?? '', l, paper.keywords ?? []) : [], [l, paper?.aiSummary, paper?.keywords]);
  const titleDisplay = paper ? resolvePaperTitleDisplay(paper, titleDisplayMode) : null;

  const closeEdit = () => {
    if (paper) setDraft(createPaperDetailsDraft(paper));
    setEditing(false);
    setInlineField(null);
    setInlineError('');
    setDraftErrors({});
  };

  const saveRequest = async (request: UpdatePaperRequest, categoryIds?: string[]) => {
    if (!paper) throw new Error(l('没有选中的文献。', 'No paper is selected.'));
    const saved = await onSavePaper(request, categoryIds);
    if (saved) {
      setPaper(saved);
      setDraft(createPaperDetailsDraft(saved));
    }
    setDraftErrors({});
    setEditing(false);
    setInlineField(null);
    toast({ tone: 'success', message: l('文献信息已保存', 'Paper metadata saved') });
    return saved;
  };

  const switchToPending = () => {
    const target = pendingPaper;
    setPaper(target);
    setDraft(target ? createPaperDetailsDraft(target) : null);
    setDraftErrors({});
    setEditing(false);
    setPendingPaper(null);
    setSwitchDialogOpen(false);
    setInlineField(null);
    setReadingHeatmap(target ? getLatestHeatmap(target.id) : null);
    onRestorePaperSelection(target?.id ?? null);
  };

  const cancelPendingSwitch = () => {
    setSwitchDialogOpen(false);
    setPendingPaper(null);
    onRestorePaperSelection(paper?.id ?? null);
  };

  const saveThenSwitch = async () => {
    if (saving || !paper || !draft) return;
    const errors = validatePaperDraft(draft);
    if (Object.keys(errors).length) {
      setDraftErrors(errors);
      setSwitchDialogOpen(false);
      setPendingPaper(null);
      setEditing(true);
      onRestorePaperSelection(paper.id);
      return;
    }
    try {
      await saveRequest(buildPaperDraftUpdateRequest(paper, draft), draft.categories);
      switchToPending();
    } catch {
      setSwitchDialogOpen(false);
      setPendingPaper(null);
      setEditing(true);
      onRestorePaperSelection(paper.id);
    }
  };

  const startInlineEdit = (key: InlineFieldKey, value: string) => {
    setInlineField(key);
    setInlineValue(value);
    setInlineError('');
  };

  const commitInlineEdit = async () => {
    if (saving || !paper || !draft || !inlineField) return;
    const next = { ...draft, [inlineField]: inlineValue };
    const errors = validatePaperDraft(next);
    const error = errors[inlineField];
    if (error) {
      setInlineError(error);
      return;
    }
    const value = inlineField === 'doi' ? (inlineValue.trim() ? normalizeDoi(inlineValue) : null) : inlineField === 'year' ? (inlineValue.trim() || null) : inlineValue.trim() || paper.title;
    try {
      await saveRequest({ paperId: paper.id, [inlineField]: value }, paper.categoryIds);
      setInlineField(null);
    } catch {
      // Parent reports the failure in its shared error channel.
    }
  };

  useEffect(() => {
    if (!editing || !paper || !draft) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!saving && !recognitionOpen && !languageDialogOpen && !switchDialogOpen) {
          const errors = validatePaperDraft(draft);
          setDraftErrors(errors);
          if (Object.keys(errors).length === 0) {
            void saveRequest(buildPaperDraftUpdateRequest(paper, draft), draft.categories).catch(() => {});
          }
        }
      } else if (event.key === 'Escape' && !recognitionOpen && !languageDialogOpen && !switchDialogOpen) {
        event.preventDefault();
        closeEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, editing, languageDialogOpen, paper, recognitionOpen, saving, switchDialogOpen]);

  const toggleFavorite = async () => {
    if (!paper || saving) return;
    try {
      const updated = await onSavePaper({ paperId: paper.id, isFavorite: !paper.isFavorite }, paper.categoryIds);
      if (!updated) return;
      setPaper(updated);
      toast({
        tone: 'success',
        message: updated.isFavorite
          ? l('已加入收藏', 'Added to favorites')
          : l('已取消收藏', 'Removed from favorites'),
      });
    } catch {
      // Parent reports the failure in its shared error channel.
    }
  };

  const showMoreMenu = (anchor: HTMLButtonElement) => {
    if (!paper) return;
    const rect = anchor.getBoundingClientRect();
    const copy = async (text: string, label: string) => {
      const ok = await copyTextToClipboard(text);
      toast(ok ? { tone: 'success', message: l(`已复制${label}`, `${label} copied`) } : { tone: 'error', message: l('复制失败', 'Copy failed') });
    };
    const entries: MenuEntry[] = [
      { id: 'copy-doi', label: l('复制 DOI', 'Copy DOI'), icon: <Copy className="h-4 w-4" />, disabled: !paper.doi, onSelect: () => paper.doi ? copy(paper.doi, 'DOI') : undefined },
      { id: 'copy-gbt', label: l('复制引用（GB/T 7714）', 'Copy Citation (GB/T 7714)'), icon: <Copy className="h-4 w-4" />, onSelect: () => copy(formatBibliographyEntry(paper, paper.title, 'gbt7714'), l('引用', 'Citation')) },
      { id: 'copy-apa', label: l('复制引用（APA）', 'Copy Citation (APA)'), icon: <Copy className="h-4 w-4" />, onSelect: () => copy(formatBibliographyEntry(paper, paper.title, 'apa7'), l('引用', 'Citation')) },
      { id: 'copy-bibtex', label: l('复制 BibTeX', 'Copy BibTeX'), icon: <Copy className="h-4 w-4" />, onSelect: () => copy(paperToBibtexEntry(paper), 'BibTeX') },
      { id: 'reidentify', label: l('按 DOI 重新识别…', 'Re-identify by DOI…'), icon: <Languages className="h-4 w-4" />, disabled: saving || editing || inlineField !== null, onSelect: () => setRecognitionOpen(true) },
      { type: 'separator', id: 'paper-menu-rag-separator' },
      { id: 'toggle-rag', label: paper.ragEnabled === false ? l('加入本地知识库', 'Include in Local Knowledge Base') : l('移出本地知识库', 'Exclude from Local Knowledge Base'), disabled: !onSetRagMembership || ragMembershipBusy, icon: <FileText className="h-4 w-4" />, onSelect: () => {
        if (paper.ragEnabled === false) onSetRagMembership?.(paper, true);
        else setExcludeConfirmOpen(true);
      } },
      ...fileLocationEntries,
      { type: 'separator', id: 'paper-menu-delete-separator' },
      { id: 'delete-paper', label: l('删除文献…', 'Delete Paper…'), tone: 'danger', icon: <Trash2 className="h-4 w-4" />, disabled: !onDeletePaper, onSelect: () => onDeletePaper?.(paper) },
    ];
    setOpenMenu({ x: rect.left, y: rect.bottom + 4, anchor, entries });
  };

  if (!paper || !draft) {
    return (
      <aside ref={rootRef} onWheelCapture={handleWheelCapture} className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-l">
        <div className="m-4 rounded-[var(--pq-radius-sm)] border border-dashed border-[var(--pq-border)] p-6 text-center text-sm text-[var(--pq-text-muted)]">{l('选择一篇文献查看详情。', 'Select a paper to view its details.')}</div>
      </aside>
    );
  }

  const authors = paper.authors.length ? paper.authors : [];
  const duplicateCitationKey = hasDuplicateCitationKey(draft.citationKey, allPapers, paper.id);

  return (
    <aside ref={rootRef} onWheelCapture={handleWheelCapture} className="pq-library-pane relative flex h-full min-h-0 flex-col overflow-hidden border-l">
      <div data-wheel-scroll-target className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3">
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold leading-6 text-[var(--pq-text)]">
                <InlineEditor label={l('标题', 'Title')} value={titleDisplay?.primary ?? paper.title} active={inlineField === 'title'} draftValue={inlineValue} error={inlineError} onBegin={() => startInlineEdit('title', paper.title)} onChange={setInlineValue} onCommit={() => void commitInlineEdit()} onCancel={() => { setInlineField(null); setInlineError(''); }} />
              </div>
              {titleDisplay?.secondary ? <div className="mt-0.5 text-sm leading-5 text-[var(--pq-text-muted)]">{titleDisplay.secondary}</div> : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--pq-text-muted)]">
                <div className="flex flex-wrap items-center gap-x-1.5">
                  {authors.length ? authors.map((author, index) => {
                    const orcid = normalizeOrcid(author.orcid);
                    return <span key={author.id} className="inline-flex items-center gap-1" title={author.affiliation ?? undefined}>
                      {index > 0 ? <span>,</span> : null}{author.name}
                      {orcid ? <a href={`https://orcid.org/${orcid}`} target="_blank" rel="noreferrer" title={author.affiliation || l('打开 ORCID', 'Open ORCID')} aria-label={l(`${author.name} 的 ORCID`, `${author.name}'s ORCID`)} className="text-[var(--pq-accent)]"><ExternalLink className="h-3 w-3" /></a> : null}
                    </span>;
                  }) : <span>{l('未知作者', 'Unknown Authors')}</span>}
                </div>
                <span aria-hidden="true">·</span>
                <span><InlineEditor label={l('年份', 'Year')} value={paper.year ?? ''} active={inlineField === 'year'} draftValue={inlineValue} error={inlineError} onBegin={() => startInlineEdit('year', paper.year ?? '')} onChange={setInlineValue} onCommit={() => void commitInlineEdit()} onCancel={() => { setInlineField(null); setInlineError(''); }} /></span>
                {paper.publication ? <><span aria-hidden="true">·</span><span className="max-w-48 truncate">{paper.publication}</span></> : null}
                {paper.doi ? <><span aria-hidden="true">·</span><span><InlineEditor label="DOI" value={paper.doi} active={inlineField === 'doi'} draftValue={inlineValue} error={inlineError} onBegin={() => startInlineEdit('doi', paper.doi ?? '')} onChange={setInlineValue} onCommit={() => void commitInlineEdit()} onCancel={() => { setInlineField(null); setInlineError(''); }} /></span></> : <button type="button" className="text-[var(--pq-accent)] hover:underline" onClick={() => startInlineEdit('doi', '')}>{l('添加 DOI', 'Add DOI')}</button>}
              </div>
            </div>
            <button type="button" disabled={saving} onClick={toggleFavorite} aria-label={paper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')} title={paper.isFavorite ? l('取消收藏', 'Remove from favorites') : l('加入收藏', 'Add to favorites')} className={paper.isFavorite ? 'pq-icon-button h-8 w-8 shrink-0 !text-[var(--pq-warning)]' : 'pq-icon-button h-8 w-8 shrink-0'}>
              <Star className="h-4 w-4" fill={paper.isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" disabled={saving} onClick={(event) => showMoreMenu(event.currentTarget)} aria-label={l('更多文献操作', 'More paper actions')} title={l('更多', 'More')} className="pq-icon-button h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!paperPdfPath(paper, storageDir)} onClick={() => onOpenPaper(paper)} className="pq-button-primary px-3 py-1.5 text-xs"><BookOpenText className="mr-1.5 inline h-3.5 w-3.5" />{l('打开阅读', 'Open Reader')}</button>
            <button type="button" disabled={saving} onClick={() => { setDraft(createPaperDetailsDraft(paper)); setEditing(true); }} className="pq-button px-3 py-1.5 text-xs"><Pencil className="mr-1.5 inline h-3.5 w-3.5" />{l('编辑', 'Edit')}</button>
          </div>

          <PaperDetailsStatusBar
            paper={paper}
            actionState={actionState}
            paperStatus={paperStatus}
            ragStatus={ragStatus}
            storageDir={storageDir}
            onOpenPaper={onOpenPaper}
            onRunMineruParse={onRunMineruParse}
            onTranslatePaper={onTranslatePaper}
            onGenerateSummary={onGenerateSummary}
            onSetRagMembership={onSetRagMembership}
            onIndexPaperRag={onIndexPaperRag}
            onAttachTranslatedPdf={onAttachTranslatedPdf}
            onRemoveTranslatedPdf={onRemoveTranslatedPdf}
            onSetTranslatedPdfLanguage={() => setLanguageDialogOpen(true)}
          />

          {editing ? (
            <PaperEditForm
              paper={paper}
              draft={draft}
              categories={categories}
              libraryTags={libraryTags}
              saving={saving}
              duplicateCitationKey={duplicateCitationKey}
              errors={draftErrors}
              onValidationErrors={setDraftErrors}
              onDraftChange={(nextDraft) => { setDraft(nextDraft); setDraftErrors(validatePaperDraft(nextDraft)); }}
              onSave={saveRequest}
              onCancel={closeEdit}
              onTranslateTitle={onTranslatePaperTitle}
            />
          ) : (
            <div className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-3">
              <DetailsSection title={l('信息', 'Information')} collapsed={sections.information} onToggle={() => toggleSection('information')}>
                <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-[var(--pq-text-faint)]">{l('类型', 'Type')}</dt><dd className="mt-0.5 text-[var(--pq-text)]">{paper.itemType || l('期刊论文', 'Journal Article')}</dd></div>
                  <div><dt className="text-[var(--pq-text-faint)]">{l('出版物 / 机构', 'Publication / Institution')}</dt><dd className="mt-0.5 text-[var(--pq-text)]">{paper.institution || paper.publisher || paper.publication || l('未设置', 'Not set')}</dd></div>
                  {paper.volume || paper.issue || paper.pages ? <div className="sm:col-span-2"><dt className="text-[var(--pq-text-faint)]">{l('卷期页', 'Volume, Issue, Pages')}</dt><dd className="mt-0.5 text-[var(--pq-text)]">{[paper.volume && `${l('卷', 'Vol.')} ${paper.volume}`, paper.issue && `${l('期', 'Issue')} ${paper.issue}`, paper.pages && `${l('页', 'pp.')} ${paper.pages}`].filter(Boolean).join(' · ')}</dd></div> : null}
                  {paper.issn || paper.isbn ? <div className="sm:col-span-2 text-[var(--pq-text-muted)]">{paper.issn ? `ISSN ${paper.issn}` : ''}{paper.issn && paper.isbn ? ' · ' : ''}{paper.isbn ? `ISBN ${paper.isbn}` : ''}</div> : null}
                  {paper.language ? <div><dt className="text-[var(--pq-text-faint)]">{l('论文语言', 'Paper Language')}</dt><dd className="mt-0.5 text-[var(--pq-text)]">{paper.language}</dd></div> : null}
                  {paper.citationKey ? <div><dt className="text-[var(--pq-text-faint)]">{l('引用键', 'Citation Key')}</dt><dd className="mt-0.5 font-mono text-[var(--pq-text)]">{paper.citationKey}</dd></div> : null}
                  {paper.doi ? <div className="sm:col-span-2"><dt className="text-[var(--pq-text-faint)]">DOI</dt><dd className="mt-0.5 break-all"><a href={`https://doi.org/${normalizeDoi(paper.doi) ?? paper.doi}`} target="_blank" rel="noreferrer" className="text-[var(--pq-accent)] hover:underline">{paper.doi}</a></dd></div> : null}
                  {paper.url ? <div className="sm:col-span-2"><dt className="text-[var(--pq-text-faint)]">URL</dt><dd className="mt-0.5 break-all"><a href={paper.url} target="_blank" rel="noreferrer" className="text-[var(--pq-accent)] hover:underline">{paper.url}</a></dd></div> : null}
                </dl>
              </DetailsSection>

              {paper.abstractText ? <DetailsSection title={l('摘要', 'Abstract')} collapsed={sections.abstract} onToggle={() => toggleSection('abstract')}><p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text-muted)]">{paper.abstractText}</p></DetailsSection> : null}

              <DetailsSection title={l('AI 概览', 'AI Overview')} collapsed={sections.overview} onToggle={() => toggleSection('overview')}>
                {overviewSections.length ? <div className="space-y-3">{overviewSections.map((section, index) => <div key={`${index}:${section.key ?? section.title}`}><h4 className="text-xs font-semibold text-[var(--pq-text)]">{section.title}</h4><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text-muted)]">{section.content}</p></div>)}</div> : <p className="text-xs text-[var(--pq-text-faint)]">{l('生成概览后，结果会显示在这里。', 'The generated overview will appear here.')}</p>}
              </DetailsSection>

              {paper.keywords.length || paper.tags.length ? <DetailsSection title={l('关键词与标签', 'Keywords & Tags')} collapsed={sections.keywords} onToggle={() => toggleSection('keywords')}>
                <div className="flex flex-wrap gap-1.5">{paper.keywords.map((keyword) => <span key={keyword} className="pq-chip px-2 py-1 text-xs">{keyword}</span>)}{paper.tags.map((tag) => <span key={tag.id} className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-accent-border)] bg-[var(--pq-accent-soft)] px-2 py-1 text-xs text-[var(--pq-accent)]">{tag.name}</span>)}</div>
              </DetailsSection> : null}

              {paper.userNote || paper.citation ? <DetailsSection title={l('笔记与引用', 'Notes & Citation')} collapsed={sections.notes} onToggle={() => toggleSection('notes')}>
                {paper.userNote ? <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text-muted)]">{paper.userNote}</p> : null}
                {paper.citation ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--pq-text-muted)]">{paper.citation}</p> : null}
              </DetailsSection> : null}

              <DetailsSection title={l('阅读时间', 'Reading Time')} collapsed={sections.readingTime} onToggle={() => toggleSection('readingTime')}>
                <LiteratureReadingTimeChart heatmap={readingHeatmap} />
              </DetailsSection>
            </div>
          )}
        </div>
      </div>

      {openMenu ? <Menu x={openMenu.x} y={openMenu.y} entries={openMenu.entries} onClose={() => { setOpenMenu(null); openMenu.anchor.focus(); }} keyboardAnchor={openMenu.anchor} width={260} /> : null}
      {recognitionOpen ? <MetadataRecognitionDialog open paper={paper} pdfPath={paperPdfPath(paper, storageDir)} onClose={() => setRecognitionOpen(false)} onApply={(request) => saveRequest(request, paper.categoryIds).then(() => {})} /> : null}
      {languageDialogOpen && translatedPdf && onUpdateTranslatedPdfLanguage ? <TranslatedPdfLanguageDialog paperTitle={paper.title} fileName={translatedPdf.attachment.fileName} language={translatedPdf.attachment.language ?? null} saving={saving} onClose={() => setLanguageDialogOpen(false)} onSave={(language) => onUpdateTranslatedPdfLanguage(paper, translatedPdf.attachment.id, language).then(() => setLanguageDialogOpen(false))} onClear={() => onUpdateTranslatedPdfLanguage(paper, translatedPdf.attachment.id, null).then(() => setLanguageDialogOpen(false))} /> : null}
      <ConfirmDialog open={excludeConfirmOpen} title={l('移出本地知识库', 'Exclude from Local Knowledge Base')} description={l('将删除该文献已建立的索引；PDF、解析结果和笔记保留。', 'This removes the paper index. The PDF, parsed content, and notes remain.')} confirmLabel={l('移出', 'Exclude')} cancelLabel={l('取消', 'Cancel')} busy={ragMembershipBusy} danger onClose={() => setExcludeConfirmOpen(false)} onConfirm={() => { setExcludeConfirmOpen(false); onSetRagMembership?.(paper, false); }} />
      <Dialog
        open={switchDialogOpen}
        onClose={() => {
          if (!saving) cancelPendingSwitch();
        }}
        dismissOnBackdrop={!saving}
        labelledBy="paper-details-switch-title"
        describedBy="paper-details-switch-description"
      >
        <div className="p-5">
          <h2 id="paper-details-switch-title" className="text-base font-semibold text-[var(--pq-text)]">
            {l('草稿尚未保存', 'Unsaved Changes')}
          </h2>
          <p id="paper-details-switch-description" className="mt-2 text-sm leading-6 text-[var(--pq-text-muted)]">
            {l('切换文献前要如何处理当前草稿？', 'What should happen to this draft before switching papers?')}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={cancelPendingSwitch} className="pq-button px-3 py-2 text-sm disabled:opacity-60">
              {l('取消切换', 'Cancel Switch')}
            </button>
            <button type="button" disabled={saving} onClick={() => void saveThenSwitch()} className="pq-button-primary px-3 py-2 text-sm disabled:opacity-60">
              {saving ? l('正在保存…', 'Saving…') : l('保存并切换', 'Save and Switch')}
            </button>
            <button type="button" disabled={saving} onClick={switchToPending} className="pq-button px-3 py-2 text-sm disabled:opacity-60">
              {l('放弃并切换', 'Discard and Switch')}
            </button>
          </div>
        </div>
      </Dialog>
    </aside>
  );
}
