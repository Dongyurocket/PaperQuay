import { useId, useState, type ReactNode } from 'react';
import { GripVertical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useLocaleText } from '../../../i18n/uiLanguage';
import type { LibraryTagCount, LiteratureCategory, LiteraturePaper, UpdatePaperRequest } from '../../../types/library';
import { buildCitationKey } from '../../../utils/bibtex';
import { buildPaperDraftUpdateRequest, splitAuthorString, validatePaperDraft, type PaperDetailsDraft, type PaperDraftErrors } from './paperDetailsDraft';
import { isValidOrcid } from '../metadataValidation';
import MetadataChipInput from './MetadataChipInput';

interface PaperEditFormProps {
  paper: LiteraturePaper;
  draft: PaperDetailsDraft;
  categories: LiteratureCategory[];
  libraryTags: LibraryTagCount[];
  saving: boolean;
  duplicateCitationKey: boolean;
  errors: PaperDraftErrors;
  onValidationErrors: (errors: PaperDraftErrors) => void;
  onDraftChange: (draft: PaperDetailsDraft) => void;
  onSave: (request: UpdatePaperRequest, categoryIds: string[]) => Promise<LiteraturePaper | void>;
  onCancel: () => void;
  onTranslateTitle?: (paper: LiteraturePaper) => Promise<string | null>;
}

function TextField({
  label,
  value,
  error,
  placeholder,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  error?: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const errorId = error ? `paper-field-error-${id.replace(/:/g, '')}` : undefined;
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-[var(--pq-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        onChange={(event) => onChange(event.target.value)}
        className="pq-input h-9 w-full px-2.5 text-sm"
      />
      {error ? <span id={errorId} className="mt-1 block text-xs text-[var(--pq-danger)]">{error}</span> : null}
    </label>
  );
}

function TextBlock({ label, value, rows = 4, onChange }: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--pq-text-muted)]">{label}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className="pq-input w-full resize-y px-2.5 py-2 text-sm leading-5" />
    </label>
  );
}

function EditGroup({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="border-b border-[var(--pq-border-subtle)] py-2 last:border-b-0">
      <summary className="cursor-pointer list-none py-1 text-sm font-semibold text-[var(--pq-text)] marker:hidden">{title}</summary>
      <div className="grid gap-3 py-3">{children}</div>
    </details>
  );
}

function translatedError(error: string, l: (zh: string, en: string) => string): string {
  switch (error) {
    case 'invalid-year': return l('年份须为 1000 至明年之间的四位数。', 'Enter a four-digit year between 1000 and next year.');
    case 'invalid-doi': return l('DOI 格式无效。', 'The DOI format is invalid.');
    case 'invalid-issn': return l('ISSN 格式或校验位无效。', 'The ISSN format or checksum is invalid.');
    case 'invalid-url': return l('请输入有效的 HTTP 或 HTTPS URL。', 'Enter a valid HTTP or HTTPS URL.');
    case 'invalid-language': return l('请输入有效的 BCP 47 论文语言标签。', 'Enter a valid BCP 47 paper-language tag.');
    case 'invalid-citation-key': return l('引用键只能包含字母、数字、下划线、冒号、连字符和句点。', 'Citation keys may contain letters, numbers, underscore, colon, hyphen, and period.');
    case 'invalid-orcid': return l('ORCID 格式或校验位无效。', 'The ORCID format or checksum is invalid.');
    default: return error;
  }
}

export default function PaperEditForm({
  paper,
  draft,
  categories,
  libraryTags,
  saving,
  duplicateCitationKey,
  errors,
  onValidationErrors,
  onDraftChange,
  onSave,
  onCancel,
  onTranslateTitle,
}: PaperEditFormProps) {
  const l = useLocaleText();
  const [savingError, setSavingError] = useState('');
  const [draggedAuthorIndex, setDraggedAuthorIndex] = useState<number | null>(null);
  const patch = (value: Partial<PaperDetailsDraft>) => {
    const nextDraft = { ...draft, ...value };
    onDraftChange(nextDraft);
    onValidationErrors(validatePaperDraft(nextDraft));
  };
  const setAuthor = (index: number, value: Partial<PaperDetailsDraft['authors'][number]>) => {
    patch({ authors: draft.authors.map((author, authorIndex) => authorIndex === index ? { ...author, ...value } : author) });
  };

  const submit = async () => {
    if (saving) return;
    const nextErrors = validatePaperDraft(draft);
    onValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSavingError('');
    try {
      await onSave(buildPaperDraftUpdateRequest(paper, draft), draft.categories);
    } catch (error) {
      setSavingError(error instanceof Error ? error.message : l('保存文献失败。', 'Failed to save the paper.'));
    }
  };

  const onAuthorPaste = (index: number, event: React.ClipboardEvent<HTMLInputElement>) => {
    const value = event.clipboardData.getData('text');
    if (!/[\n;；、,，]/.test(value)) return;
    event.preventDefault();
    const names = splitAuthorString(value).map((name) => ({ name }));
    const authors = [...draft.authors];
    authors.splice(index, 1, ...names);
    patch({ authors });
  };

  const moveAuthor = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= draft.authors.length) return;
    const authors = [...draft.authors];
    const [author] = authors.splice(from, 1);
    authors.splice(to, 0, author);
    patch({ authors });
  };

  const journalLabel = draft.itemType === 'book' || draft.itemType === 'bookSection'
    ? l('书名 / 丛书', 'Book / Series')
    : draft.itemType === 'conferencePaper'
      ? l('会议名称', 'Conference')
      : l('期刊 / 会议', 'Journal / Conference');
  const isBookType = draft.itemType === 'book' || draft.itemType === 'bookSection';
  const showsVolume = ['journalArticle', 'bookSection', 'conferencePaper', 'preprint', 'report'].includes(draft.itemType);
  const showsIssue = ['journalArticle', 'conferencePaper'].includes(draft.itemType);
  const showsPages = ['journalArticle', 'bookSection', 'conferencePaper', 'report', 'thesis'].includes(draft.itemType);
  const showsIsbn = isBookType;
  const showsIssn = draft.itemType === 'journalArticle' || draft.itemType === 'conferencePaper';
  const showsReportNumber = draft.itemType === 'report';
  const showsPublication = draft.itemType !== 'thesis';
  const automaticCitationKey = paper.citationKey || buildCitationKey(paper);

  return (
    <div className="pq-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--pq-text)]">{l('编辑元数据', 'Edit Metadata')}</h3>
        <span className="text-xs text-[var(--pq-text-faint)]">{l('字段分组可折叠', 'Groups can be collapsed')}</span>
      </div>

      <EditGroup title={l('基本信息', 'Basic')} open>
        <TextField label={l('标题', 'Title')} value={draft.title} onChange={(title) => patch({ title })} />
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--pq-text-muted)]">
            {l('中文标题', 'Chinese Title')}
            {onTranslateTitle ? (
              <button type="button" className="pq-button px-2 py-1 text-[11px]" disabled={saving} onClick={() => void onTranslateTitle(paper).then((title) => { if (title) patch({ titleZh: title }); })}>
                <Sparkles className="mr-1 inline h-3 w-3" />{l('AI 翻译', 'Translate')}
              </button>
            ) : null}
          </span>
          <input value={draft.titleZh} onChange={(event) => patch({ titleZh: event.target.value })} className="pq-input h-9 w-full px-2.5 text-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={l('论文语言', 'Paper Language')} value={draft.language} placeholder="en, zh-CN" error={errors.language ? translatedError(errors.language, l) : undefined} onChange={(language) => patch({ language })} />
          <TextField label={l('年份', 'Year')} value={draft.year} error={errors.year ? translatedError(errors.year, l) : undefined} onChange={(year) => patch({ year })} />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--pq-text-muted)]">{l('文献类型', 'Item Type')}</span>
          <select value={draft.itemType} onChange={(event) => patch({ itemType: event.target.value })} className="pq-input h-9 w-full px-2.5 text-sm">
            <option value="journalArticle">{l('期刊论文', 'Journal Article')}</option>
            <option value="book">{l('书籍', 'Book')}</option>
            <option value="bookSection">{l('书籍章节', 'Book Section')}</option>
            <option value="conferencePaper">{l('会议论文', 'Conference Paper')}</option>
            <option value="thesis">{l('学位论文', 'Thesis')}</option>
            <option value="report">{l('报告', 'Report')}</option>
            <option value="preprint">{l('预印本', 'Preprint')}</option>
            <option value="misc">{l('其他', 'Other')}</option>
          </select>
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--pq-text-muted)]">
            {l('作者', 'Authors')}
            <button type="button" className="pq-button px-2 py-1 text-xs" onClick={() => patch({ authors: [...draft.authors, { name: '' }] })}>
              <Plus className="mr-1 inline h-3 w-3" />{l('添加作者', 'Add Author')}
            </button>
          </div>
          {draft.authors.length === 0 ? <div className="py-2 text-xs text-[var(--pq-text-faint)]">{l('尚无作者', 'No authors')}</div> : null}
          <div className="space-y-2">
        {draft.authors.map((author, index) => (
              <details
                key={author.id ?? `new-author-${index}`}
                draggable
                onDragStart={() => setDraggedAuthorIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (draggedAuthorIndex !== null) moveAuthor(draggedAuthorIndex, index); setDraggedAuthorIndex(null); }}
                className="rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] p-2"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 marker:hidden">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--pq-text-faint)]" aria-label={l('拖动以调整作者顺序', 'Drag to reorder authors')} />
                  <input
                    value={author.name}
                    aria-label={l(`第 ${index + 1} 位作者`, `Author ${index + 1}`)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setAuthor(index, { name: event.target.value })}
                    onPaste={(event) => onAuthorPaste(index, event)}
                    className="pq-input h-8 min-w-0 flex-1 px-2 text-sm"
                  />
                  <button type="button" className="pq-icon-button h-7 w-7 shrink-0" aria-label={l('删除作者', 'Remove author')} onClick={(event) => { event.preventDefault(); patch({ authors: draft.authors.filter((_, itemIndex) => itemIndex !== index) }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <TextField label={l('作者单位', 'Affiliation')} value={author.affiliation ?? ''} onChange={(affiliation) => setAuthor(index, { affiliation })} />
                  <TextField label="ORCID" value={author.orcid ?? ''} placeholder="0000-0002-1825-0097" error={author.orcid && !isValidOrcid(author.orcid) && errors.orcid ? translatedError(errors.orcid, l) : undefined} onChange={(orcid) => setAuthor(index, { orcid })} />
                </div>
              </details>
            ))}
          </div>
        </div>
      </EditGroup>

      <EditGroup title={l('出版信息', 'Publication')}>
        {showsPublication ? <TextField label={journalLabel} value={draft.publication} onChange={(publication) => patch({ publication })} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={draft.itemType === 'thesis' ? l('授予单位', 'University / School') : l('出版社', 'Publisher')} value={draft.publisher} onChange={(publisher) => patch({ publisher })} />
          <TextField label={l('机构', 'Institution')} value={draft.institution} onChange={(institution) => patch({ institution })} />
        </div>
        {showsReportNumber ? <TextField label={l('报告编号', 'Report Number')} value={draft.reportNumber} onChange={(reportNumber) => patch({ reportNumber })} /> : null}
        {showsVolume || showsIssue || showsPages ? <div className="grid gap-3 sm:grid-cols-3">
          {showsVolume ? <TextField label={l('卷', 'Volume')} value={draft.volume} onChange={(volume) => patch({ volume })} /> : null}
          {showsIssue ? <TextField label={l('期', 'Issue')} value={draft.issue} onChange={(issue) => patch({ issue })} /> : null}
          {showsPages ? <TextField label={l('页码', 'Pages')} value={draft.pages} onChange={(pages) => patch({ pages })} /> : null}
        </div> : null}
      </EditGroup>

      <EditGroup title={l('标识', 'Identifiers')}>
        <TextField label="DOI" value={draft.doi} error={errors.doi ? translatedError(errors.doi, l) : undefined} onChange={(doi) => patch({ doi })} />
        {showsIsbn || showsIssn ? <div className="grid gap-3 sm:grid-cols-2">
          {showsIsbn ? <TextField label="ISBN" value={draft.isbn} onChange={(isbn) => patch({ isbn })} /> : null}
          {showsIssn ? <TextField label="ISSN" value={draft.issn} error={errors.issn ? translatedError(errors.issn, l) : undefined} onChange={(issn) => patch({ issn })} /> : null}
        </div> : null}
        <TextField label="URL" value={draft.url} error={errors.url ? translatedError(errors.url, l) : undefined} onChange={(url) => patch({ url })} />
        <TextField label={l('引用键', 'Citation Key')} value={draft.citationKey} placeholder={automaticCitationKey} error={errors.citationKey ? translatedError(errors.citationKey, l) : undefined} onChange={(citationKey) => patch({ citationKey })} />
        {duplicateCitationKey ? <p className="text-xs text-[var(--pq-warning)]">{l('该引用键已被其他文献使用；仍可保存。', 'Another paper uses this citation key; it can still be saved.')}</p> : null}
      </EditGroup>

      <EditGroup title={l('内容', 'Content')}>
        <TextBlock label={l('摘要', 'Abstract')} value={draft.abstractText} rows={5} onChange={(abstractText) => patch({ abstractText })} />
        <MetadataChipInput label={l('关键词', 'Keywords')} values={draft.keywords} placeholder={l('输入后按 Enter 添加', 'Type and press Enter')} onChange={(keywords) => patch({ keywords })} />
      </EditGroup>

      <EditGroup title={l('整理', 'Organization')}>
        <MetadataChipInput label={l('标签', 'Tags')} values={draft.tags} suggestions={libraryTags.map((tag) => tag.name)} placeholder={l('输入后按 Enter 添加', 'Type and press Enter')} onChange={(tags) => patch({ tags })} />
        <div>
          <div className="mb-1 text-xs font-medium text-[var(--pq-text-muted)]">{l('分类（可多选）', 'Categories (multiple selection)')}</div>
          <div className="max-h-36 space-y-1 overflow-y-auto rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] p-2">
            {categories.filter((category) => !category.isSystem).map((category) => (
              <label key={category.id} className="flex items-center gap-2 py-1 text-sm text-[var(--pq-text)]">
                <input type="checkbox" checked={draft.categories.includes(category.id)} onChange={(event) => patch({ categories: event.target.checked ? [...draft.categories, category.id] : draft.categories.filter((id) => id !== category.id) })} />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
        </div>
      </EditGroup>

      <EditGroup title={l('备注', 'Notes')}>
        <TextBlock label={l('用户笔记', 'User Note')} value={draft.userNote} rows={5} onChange={(userNote) => patch({ userNote })} />
        <TextBlock label={l('引用信息', 'Citation')} value={draft.citation} rows={3} onChange={(citation) => patch({ citation })} />
      </EditGroup>

      {savingError ? <div role="alert" className="mt-3 rounded-[var(--pq-radius-sm)] bg-[var(--pq-error-bg)] p-2 text-sm text-[var(--pq-danger)]">{savingError}</div> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onCancel} className="pq-button px-3 py-2 text-sm disabled:opacity-50">{l('放弃', 'Discard')}</button>
        <button type="button" disabled={saving} onClick={() => void submit()} className="pq-button-primary px-3 py-2 text-sm disabled:opacity-50">{saving ? l('正在保存…', 'Saving…') : l('保存修改', 'Save Changes')}</button>
      </div>
    </div>
  );
}
