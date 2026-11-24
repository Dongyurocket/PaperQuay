import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { pickDocumentLocaleText } from '../../../i18n/uiLanguage';

export interface NoteSuggestionItem {
  id: string;
  label: string;
  description?: string;
  /** UI 数据项（如模板命令）的英文展示文案；普通数据（笔记标题/标签）留空。 */
  labelEn?: string;
  descriptionEn?: string;
  /** slash 基础命令以英文为 label，中文展示走 labelZh/descriptionZh。 */
  labelZh?: string;
  descriptionZh?: string;
}

function placePopup(popup: HTMLDivElement, props: SuggestionProps<NoteSuggestionItem>) {
  let rect: DOMRect | null = null;
  try {
    rect = props.clientRect?.() ?? null;
  } catch {
    rect = null;
  }

  if (!rect) {
    try {
      const coords = props.editor.view.coordsAtPos(props.range.to);
      rect = new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
    } catch {
      rect = null;
    }
  }
  if (!rect) {
    const editorRect = props.editor.view.dom.getBoundingClientRect();
    rect = new DOMRect(editorRect.left + 24, editorRect.top + 24, 0, 20);
  }

  const width = Math.min(260, Math.max(180, window.innerWidth - 24));
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
  const maxTop = Math.max(12, window.innerHeight - 220);
  const top = Math.min(rect.bottom + 8, maxTop);

  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(12, top)}px`;
  popup.style.width = `${width}px`;
}

function renderItems(
  popup: HTMLDivElement,
  props: SuggestionProps<NoteSuggestionItem>,
  selectedIndex: number,
) {
  popup.replaceChildren();

  if (props.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pq-tiptap-suggestion-empty';
    empty.textContent = pickDocumentLocaleText('没有匹配项', 'No matches');
    empty.style.color = 'var(--pq-text-muted)';
    empty.style.minHeight = '34px';
    popup.appendChild(empty);
    return;
  }

  props.items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'pq-tiptap-suggestion-item',
      index === selectedIndex ? 'is-selected' : '',
    ].filter(Boolean).join(' ');

    button.style.display = 'flex';
    button.style.width = '100%';
    button.style.minHeight = '34px';
    button.style.flexDirection = 'column';
    button.style.alignItems = 'stretch';
    button.style.justifyContent = 'center';
    button.style.gap = '2px';
    button.style.border = '0';
    button.style.background = index === selectedIndex ? 'var(--pq-accent-bg)' : 'transparent';
    button.style.color = 'var(--pq-text-primary)';
    button.style.textAlign = 'left';

    const label = document.createElement('span');
    label.className = 'pq-tiptap-suggestion-label';
    // 模板项：label 中文 + labelEn 英文；slash 基础项：label 英文 + labelZh 中文；
    // 笔记标题、标签等数据项不带双语字段，保持原文。
    const zhLabel = item.labelZh ?? item.label;
    const enLabel = item.labelEn ?? (item.labelZh ? item.label : null);
    label.textContent = (enLabel
      ? pickDocumentLocaleText(zhLabel, enLabel)
      : item.label) || item.id;
    label.style.display = 'block';
    label.style.color = 'var(--pq-text-primary)';
    label.style.fontSize = '13px';
    label.style.fontWeight = '650';
    label.style.lineHeight = '18px';
    button.appendChild(label);

    if (item.description) {
      const description = document.createElement('span');
      description.className = 'pq-tiptap-suggestion-description';
      const zhDescription = item.descriptionZh ?? item.description;
      const enDescription = item.descriptionEn
        ?? (item.descriptionZh ? item.description : null);
      description.textContent = enDescription
        ? pickDocumentLocaleText(zhDescription, enDescription)
        : item.description;
      description.style.display = 'block';
      description.style.color = 'var(--pq-text-faint)';
      description.style.fontSize = '11px';
      description.style.lineHeight = '15px';
      button.appendChild(description);
    }

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      props.command(item);
    });
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    popup.appendChild(button);
  });
}

export function createSuggestionMenu() {
  let popup: HTMLDivElement | null = null;
  let latestProps: SuggestionProps<NoteSuggestionItem> | null = null;
  let selectedIndex = 0;

  const update = (props: SuggestionProps<NoteSuggestionItem>) => {
    if (!popup) return;
    latestProps = props;
    selectedIndex = Math.min(selectedIndex, Math.max(0, props.items.length - 1));
    renderItems(popup, props, selectedIndex);
    placePopup(popup, props);
  };

  const choose = () => {
    const item = latestProps?.items[selectedIndex];
    if (!item || !latestProps) return false;
    latestProps.command(item);
    return true;
  };

  const ensurePopup = () => {
    if (popup) return popup;

    popup = document.createElement('div');
    popup.className = 'pq-tiptap-suggestion-menu';
    popup.style.position = 'fixed';
    popup.style.zIndex = '2147483647';
    popup.style.display = 'block';
    popup.style.visibility = 'visible';
    popup.style.opacity = '1';
    popup.style.pointerEvents = 'auto';
    popup.style.minWidth = '260px';
    popup.style.maxWidth = '320px';
    popup.style.maxHeight = '320px';
    popup.style.overflowY = 'auto';
    popup.style.background = 'var(--pq-surface-1)';
    popup.style.color = 'var(--pq-text-primary)';
    popup.style.border = '1px solid var(--pq-border)';
    popup.style.borderRadius = 'var(--pq-radius-md)';
    popup.style.boxShadow = 'var(--pq-shadow-dialog)';
    popup.style.padding = '6px';
    popup.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    popup.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.appendChild(popup);

    return popup;
  };

  const move = (delta: number) => {
    if (!latestProps?.items.length) return false;
    selectedIndex = (selectedIndex + delta + latestProps.items.length) % latestProps.items.length;
    update(latestProps);
    return true;
  };

  return {
    onBeforeStart(props: SuggestionProps<NoteSuggestionItem>) {
      const nextPopup = ensurePopup();
      selectedIndex = 0;
      placePopup(nextPopup, props);
    },
    onStart(props: SuggestionProps<NoteSuggestionItem>) {
      ensurePopup();
      selectedIndex = 0;
      update(props);
    },
    onBeforeUpdate(props: SuggestionProps<NoteSuggestionItem>) {
      if (!popup) return;
      placePopup(popup, props);
    },
    onUpdate(props: SuggestionProps<NoteSuggestionItem>) {
      update(props);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        return move(1);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        return move(-1);
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        return choose();
      }
      return false;
    },
    onExit() {
      popup?.remove();
      popup = null;
      latestProps = null;
      selectedIndex = 0;
    },
  };
}
