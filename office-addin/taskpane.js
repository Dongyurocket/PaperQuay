/* global Office, Word, PaperQuayCitation */
/**
 * PaperQuay Word 加载项任务窗格。
 *
 * 职责分工（重要）：
 * - 本文件只负责「Word 文档模型 + UI」：内容控件的插入/刷新/取消链接、文档级设置、与本地桥的 HTTP 通信。
 * - 文献编号、条目文本、内联文本等全部由共享真源（dist/citation-shared.js，源自 src/shared/citation/）
 *   与本地桥的 POST /citations/render 计算，本文件不自行拼装引用文本。
 */
(function () {
  'use strict';

  var shared = window.PaperQuayCitation;
  var SETTINGS = shared.DOCUMENT_SETTINGS_KEYS;
  var CONNECTION_STORAGE_KEY = 'paperquay:office-addin:connection';
  var DOCUMENT_ID_KEY = 'pq:documentId';
  var BIBLIOGRAPHY_TITLE_KEY = 'pq:bibliographyTitle';
  var SUPERSCRIPT_KEY = 'pq:superscript';
  var BIB_HEADING_KEY = 'pq:bibHeading';
  var SEARCH_LIMIT = 30;

  var state = {
    port: 0,
    token: '',
    health: null,
    style: shared.DEFAULT_CITATION_STYLE,
    styles: shared.CITATION_STYLES,
    results: [],
    selected: new Map(),
    bibliographyTitle: shared.DEFAULT_BIBLIOGRAPHY_TITLE,
    superscript: false,
    bibHeading: true,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(text, kind) {
    var node = el('bridge-status');
    node.textContent = text;
    node.className = 'status status--' + (kind || 'idle');
  }

  function log(message) {
    var node = el('log');
    node.hidden = false;
    var stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    node.textContent = '[' + stamp + '] ' + message + '\n' + node.textContent;
  }

  function setNote(message) {
    var node = el('connection-note');
    if (!message) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    node.hidden = false;
    node.textContent = message;
  }

  function errorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    return error.message || String(error);
  }

  /* ------------------------------------------------------------------ 连接 */

  function parseConnectionInfo(text) {
    var value = String(text || '').trim();
    if (!value) return null;
    var separator = value.indexOf(':');
    if (separator < 0) return null;
    var port = Number.parseInt(value.slice(0, separator).trim(), 10);
    var token = value.slice(separator + 1).trim();
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) return null;
    return { port: port, token: token };
  }

  function saveConnection() {
    try {
      window.localStorage.setItem(CONNECTION_STORAGE_KEY, state.port + ':' + state.token);
    } catch (error) {
      /* 隐私模式下 localStorage 可能不可用，忽略。 */
    }
  }

  function restoreConnection() {
    try {
      return window.localStorage.getItem(CONNECTION_STORAGE_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function bridgeUrl(path) {
    return 'http://127.0.0.1:' + state.port + path;
  }

  function bridgeFetch(path, options) {
    var init = options || {};
    if (!state.port || !state.token) {
      return Promise.reject(new Error('尚未连接 PaperQuay：请先在「连接 PaperQuay」粘贴连接信息。'));
    }
    var headers = { Authorization: 'Bearer ' + state.token };
    if (init.body) headers['Content-Type'] = 'application/json';
    return fetch(bridgeUrl(path), {
      method: init.method || 'GET',
      headers: headers,
      body: init.body,
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (error) {
            payload = null;
          }
        }
        if (!response.ok) {
          var code = payload && payload.error ? payload.error.code : '';
          var message = payload && payload.error ? payload.error.message : '请求失败（' + response.status + '）';
          if (code === 'UNAUTHORIZED') message = '连接令牌不正确，请在 PaperQuay 里重新复制连接信息。';
          if (code === 'WRITE_DISABLED') message = 'PaperQuay 当前未开启「标记本文引用过」写回。';
          var failure = new Error(message);
          failure.code = code;
          throw failure;
        }
        return payload;
      });
    });
  }

  function connect(rawValue) {
    var parsed = parseConnectionInfo(rawValue);
    setNote('');
    if (!parsed) {
      setStatus('连接信息无效', 'error');
      setNote('格式应为「端口:令牌」，例如 23120:3f9c8a…（在 PaperQuay 设置里点“复制连接信息”）。');
      return Promise.resolve(false);
    }
    state.port = parsed.port;
    state.token = parsed.token;
    return bridgeFetch('/health').then(function (health) {
      state.health = health;
      saveConnection();
      el('connection-input').value = state.port + ':' + state.token;
      setStatus('已连接 · 端口 ' + health.port, 'ok');
      applyStylesFromHealth(health);
      log('已连接 PaperQuay（apiVersion ' + health.apiVersion + '，应用版本 ' + health.appVersion + '）。');
      return true;
    }).catch(function (error) {
      state.health = null;
      setStatus('连接失败', 'error');
      setNote(errorMessage(error));
      return false;
    });
  }

  function applyStylesFromHealth(health) {
    var capabilities = (health && health.capabilities) || {};
    if (Array.isArray(capabilities.styles) && capabilities.styles.length > 0) {
      var known = state.styles.filter(function (style) {
        return capabilities.styles.indexOf(style.id) >= 0;
      });
      if (known.length > 0) state.styles = known;
    }
    if (capabilities.defaultStyle) state.style = capabilities.defaultStyle;
    renderStyleOptions();
  }

  function renderStyleOptions() {
    var select = el('style-select');
    select.textContent = '';
    state.styles.forEach(function (style) {
      var option = document.createElement('option');
      option.value = style.id;
      option.textContent = style.label + (style.kind === 'numeric' ? '（顺序编码）' : '（著者-出版年）');
      option.title = style.description || '';
      if (style.id === state.style) option.selected = true;
      select.appendChild(option);
    });
  }

  /* -------------------------------------------------------- 文档级设置读写 */

  function getSetting(key) {
    try {
      return Office.context.document.settings.get(key);
    } catch (error) {
      return null;
    }
  }

  function setSetting(key, value) {
    Office.context.document.settings.set(key, value);
  }

  function saveDocumentSettings() {
    return new Promise(function (resolve, reject) {
      Office.context.document.settings.saveAsync(function (result) {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve();
          return;
        }
        reject(new Error(result.error && result.error.message ? result.error.message : '保存文档设置失败'));
      });
    });
  }

  function readStoredCitations() {
    return shared.normalizeStoredCitations(getSetting(SETTINGS.citations));
  }

  function writeStoredCitations(citations) {
    setSetting(SETTINGS.citations, shared.serializeStoredCitations(citations));
  }

  function styleFromDocument() {
    return shared.normalizeCitationStyle(getSetting(SETTINGS.style));
  }

  function documentTitle() {
    try {
      var url = Office.context.document.url || '';
      var name = url.split(/[\\/]/).pop() || '';
      return decodeURIComponent(name) || '未命名文档';
    } catch (error) {
      return '未命名文档';
    }
  }

  function ensureDocumentId() {
    var existing = getSetting(DOCUMENT_ID_KEY);
    if (typeof existing === 'string' && existing) return existing;
    var created = 'doc-' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
    setSetting(DOCUMENT_ID_KEY, created);
    return created;
  }

  /* ------------------------------------------------------------ 文档扫描 */

  function decodeOoxml(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    try {
      return window.atob(value);
    } catch (error) {
      return value;
    }
  }

  /** 按文档顺序读取引用编号（citeId）。 */
  function scanCitationOrder() {
    return Word.run(function (context) {
      var body = context.document.body;
      var result = body.getOoxml();
      return context.sync().then(function () {
        var ooxml = decodeOoxml(result.value);
        var ordered = shared.extractCitationControlTagsFromOoxml(ooxml);
        if (ordered.length > 0) return { ordered: ordered, hasBibliography: shared.hasBibliographyControlInOoxml(ooxml) };
        // 退化路径：OOXML 解析不到（例如 base64 解出的是压缩包）时，退回控件集合顺序。
        var controls = body.contentControls;
        controls.load('items/tag');
        return context.sync().then(function () {
          var fallback = [];
          var hasBibliography = false;
          controls.items.forEach(function (control) {
            var citeId = shared.parseCitationControlTag(control.tag);
            if (citeId) fallback.push(citeId);
            if (shared.isBibliographyControlTag(control.tag)) hasBibliography = true;
          });
          return { ordered: fallback, hasBibliography: hasBibliography };
        });
      });
    });
  }

  /** 按文档顺序渲染全文；返回桥的渲染结果。 */
  function renderDocument(storedOverride) {
    var stored = storedOverride || readStoredCitations();
    return scanCitationOrder().then(function (scan) {
      var groups = [];
      scan.ordered.forEach(function (citeId) {
        var storedCitation = shared.findStoredCitation(stored, citeId);
        if (!storedCitation) return;
        groups.push({ citeId: citeId, items: storedCitation.items });
      });
      if (groups.length === 0 && !scan.hasBibliography) {
        return { empty: true, scan: scan, groups: [] };
      }
      return bridgeFetch('/citations/render', {
        method: 'POST',
        body: JSON.stringify({
          style: state.style,
          groups: groups,
          bibliographyTitle: state.bibliographyTitle,
        }),
      }).then(function (render) {
        render.scan = scan;
        return render;
      });
    });
  }

  /* -------------------------------------------------------- 文档写操作 */

  /** 让控件融入正文：隐藏 Word 的内容控件外框；顺序编码制按需上标。 */
  function decorateCitationControl(control, numericKind) {
    control.appearance = Word.ContentControlAppearance.hidden;
    control.font.superscript = Boolean(numericKind && state.superscript);
  }

  function applyBibliography(control, render) {
    control.clear();
    if (state.bibHeading) {
      control.insertParagraph(render.bibliographyTitle || state.bibliographyTitle, Word.InsertLocation.end);
    }
    render.entries.forEach(function (entry) {
      var prefix = render.kind === 'numeric' ? '[' + entry.seq + '] ' : '';
      control.insertParagraph(prefix + entry.text, Word.InsertLocation.end);
    });
  }

  function applyRender(render) {
    var inlineByCiteId = new Map();
    (render.groups || []).forEach(function (group) {
      if (group && group.citeId) inlineByCiteId.set(group.citeId, group.inline);
    });
    return Word.run(function (context) {
      var body = context.document.body;
      var controls = body.contentControls;
      controls.load('items/tag,items/title');
      return context.sync().then(function () {
        var bibliography = null;
        var numeric = render.kind === 'numeric';
        controls.items.forEach(function (control) {
          var citeId = shared.parseCitationControlTag(control.tag);
          if (citeId) {
            var text = inlineByCiteId.get(citeId);
            if (typeof text === 'string' && text) {
              control.insertText(text, Word.InsertLocation.replace);
            }
            decorateCitationControl(control, numeric);
            return;
          }
          if (shared.isBibliographyControlTag(control.tag)) {
            control.appearance = Word.ContentControlAppearance.hidden;
            bibliography = control;
          }
        });
        if (bibliography) applyBibliography(bibliography, render);
        return context.sync();
      });
    });
  }

  function refreshCitations(options) {
    var silent = options && options.silent;
    return renderDocument().then(function (render) {
      if (render.empty) {
        renderCitationList([], null);
        if (!silent) log('文档里还没有 PaperQuay 引用。');
        return null;
      }
      return applyRender(render).then(function () {
        setSetting(SETTINGS.style, render.style);
        setSetting(SETTINGS.schemaVersion, shared.DOCUMENT_SCHEMA_VERSION);
        setSetting(SETTINGS.citedPaperIds, JSON.stringify(render.entries.map(function (entry) {
          return entry.paperId;
        })));
        return saveDocumentSettings().then(function () {
          renderCitationList(render.scan.ordered, render);
          if (!silent) {
            log('已刷新 ' + render.entries.length + ' 条文献，正文引用编号已重排。');
          }
          return render;
        });
      });
    });
  }

  function insertCitation() {
    var items = Array.from(state.selected.values()).map(function (paper) {
      var item = { paperId: paper.id, label: paper.title };
      var locator = el('locator-input').value.trim();
      var prefix = el('prefix-input').value.trim();
      var suffix = el('suffix-input').value.trim();
      if (locator) item.locator = locator;
      if (prefix) item.prefix = prefix;
      if (suffix) item.suffix = suffix;
      if (el('suppress-author-input').checked) item.suppressAuthor = true;
      return item;
    });
    if (items.length === 0) {
      setNote('请先在「检索文献库」里选中至少一篇文献。');
      return Promise.resolve();
    }
    setNote('');
    var citeId = shared.createCitationId();
    return bridgeFetch('/citations/render', {
      method: 'POST',
      body: JSON.stringify({ style: state.style, items: items }),
    }).then(function (render) {
      var inline = render.inline;
      var stored = shared.upsertStoredCitation(readStoredCitations(), {
        citeId: citeId,
        items: items,
        updatedAt: Date.now(),
      });
      return Word.run(function (context) {
        var range = context.document.getSelection();
        var control = range.insertContentControl();
        control.tag = shared.encodeCitationControlTag(citeId);
        control.title = shared.CITATION_CONTROL_TITLE;
        control.insertText(inline, Word.InsertLocation.replace);
        decorateCitationControl(control, render.kind === 'numeric');
        return context.sync();
      }).then(function () {
        writeStoredCitations(stored);
        ensureDocumentId();
        return saveDocumentSettings();
      }).then(function () {
        state.selected.clear();
        renderSelection();
        renderSearchResults();
        log('已插入引用：' + inline);
        return refreshCitations({ silent: true }).then(function () {
          return writeBackCited();
        });
      });
    });
  }

  function insertBibliography() {
    return renderDocument().then(function (render) {
      if (render.empty) {
        setNote('文档里还没有引用，无法生成参考文献表。');
        return null;
      }
      return Word.run(function (context) {
        var body = context.document.body;
        var controls = body.contentControls;
        controls.load('items/tag');
        return context.sync().then(function () {
          var bibliography = null;
          controls.items.forEach(function (control) {
            if (shared.isBibliographyControlTag(control.tag)) bibliography = control;
          });
          if (bibliography) {
            // 已有表：原位刷新，与光标位置无关。
            bibliography.appearance = Word.ContentControlAppearance.hidden;
            applyBibliography(bibliography, render);
            return context.sync();
          }
          // 新表插到光标处：光标落在非空段落里时另起新段，避免表被插进句子中间。
          var selection = context.document.getSelection();
          var paragraphs = selection.paragraphs;
          paragraphs.load('items/text');
          return context.sync().then(function () {
            var host = paragraphs.items.length > 0 ? paragraphs.items[0] : null;
            var target = host;
            if (!host) {
              target = body.insertParagraph('', Word.InsertLocation.end);
            } else if ((host.text || '').trim().length > 0) {
              target = host.insertParagraph('', Word.InsertLocation.after);
            }
            var created = target.insertContentControl();
            created.tag = shared.BIBLIOGRAPHY_CONTROL_TAG;
            created.title = shared.BIBLIOGRAPHY_CONTROL_TITLE;
            created.appearance = Word.ContentControlAppearance.hidden;
            applyBibliography(created, render);
            return context.sync();
          });
        });
      }).then(function () {
        setSetting(SETTINGS.bibliographyControlId, shared.BIBLIOGRAPHY_CONTROL_TAG);
        setSetting(BIBLIOGRAPHY_TITLE_KEY, state.bibliographyTitle);
        return saveDocumentSettings().then(function () {
          renderCitationList(render.scan.ordered, render);
          log('已写入参考文献表：' + render.entries.length + ' 条。');
          return writeBackCited();
        });
      });
    });
  }

  function unlinkCitations() {
    return Word.run(function (context) {
      var controls = context.document.body.contentControls;
      controls.load('items/tag');
      return context.sync().then(function () {
        var removed = 0;
        controls.items.forEach(function (control) {
          if (shared.parseCitationControlTag(control.tag) || shared.isBibliographyControlTag(control.tag)) {
            control.delete(true);
            removed += 1;
          }
        });
        return context.sync().then(function () {
          return removed;
        });
      });
    }).then(function (removed) {
      writeStoredCitations([]);
      return saveDocumentSettings().then(function () {
        renderCitationList([], null);
        log('已取消链接 ' + removed + ' 个控件：文本保留，后续不再自动刷新。');
      });
    });
  }

  function removeCitation(citeId) {
    return Word.run(function (context) {
      var controls = context.document.body.contentControls;
      controls.load('items/tag');
      return context.sync().then(function () {
        controls.items.forEach(function (control) {
          if (shared.parseCitationControlTag(control.tag) === citeId) control.delete(false);
        });
        return context.sync();
      });
    }).then(function () {
      writeStoredCitations(shared.removeStoredCitation(readStoredCitations(), citeId));
      return saveDocumentSettings();
    }).then(function () {
      log('已删除一条引用。');
      return refreshCitations({ silent: true });
    });
  }

  function writeBackCited() {
    var paperIds = [];
    readStoredCitations().forEach(function (citation) {
      (citation.items || []).forEach(function (item) {
        if (item && item.paperId && paperIds.indexOf(item.paperId) < 0) paperIds.push(item.paperId);
      });
    });
    if (paperIds.length === 0) return Promise.resolve();
    return bridgeFetch('/documents/cited', {
      method: 'POST',
      body: JSON.stringify({
        documentId: ensureDocumentId(),
        documentTitle: documentTitle(),
        paperIds: paperIds,
      }),
    }).then(function (result) {
      if (result && result.updated) log('已回写「本文引用过」：' + result.updated + ' 条。');
      return result;
    }).catch(function (error) {
      if (error && error.code === 'WRITE_DISABLED') return null;
      log('写回「本文引用过」失败：' + errorMessage(error));
      return null;
    });
  }

  /* ---------------------------------------------------------------- 渲染 */

  function renderSearchResults() {
    var container = el('search-results');
    container.textContent = '';
    state.results.forEach(function (paper) {
      var row = document.createElement('div');
      row.className = 'result' + (state.selected.has(paper.id) ? ' result--selected' : '');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selected.has(paper.id);
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) state.selected.set(paper.id, paper);
        else state.selected.delete(paper.id);
        renderSearchResults();
      });
      var body = document.createElement('div');
      body.className = 'result__body';
      var title = document.createElement('div');
      title.className = 'result__title';
      title.textContent = paper.title || '(无标题)';
      var meta = document.createElement('div');
      meta.className = 'result__meta';
      meta.textContent = metaLine(paper);
      body.appendChild(title);
      body.appendChild(meta);
      row.appendChild(checkbox);
      row.appendChild(body);
      container.appendChild(row);
    });
    renderSelection();
  }

  function metaLine(paper) {
    var authors = Array.isArray(paper.authors) ? paper.authors : [];
    var names = authors.slice(0, 3).map(function (author) {
      return author.name || author.familyName || '';
    }).filter(Boolean);
    if (authors.length > 3) names.push('等');
    return [names.join(', '), paper.year ? String(paper.year) : '', paper.publication || '']
      .filter(Boolean)
      .join(' · ');
  }

  function renderSelection() {
    var node = el('selection');
    if (state.selected.size === 0) {
      node.textContent = '未选择文献';
      return;
    }
    var titles = Array.from(state.selected.values()).map(function (paper) {
      return paper.title || '(无标题)';
    });
    node.textContent = '已选 ' + state.selected.size + ' 篇：' + titles.join('；');
  }

  function renderCitationList(orderedCiteIds, render) {
    var container = el('document-citations');
    container.textContent = '';
    var stored = readStoredCitations();
    var seqByPaperId = new Map();
    if (render && Array.isArray(render.entries)) {
      render.entries.forEach(function (entry) {
        if (entry && entry.paperId) seqByPaperId.set(entry.paperId, entry.seq);
      });
    }
    var ordered = (orderedCiteIds && orderedCiteIds.length > 0)
      ? orderedCiteIds
      : stored.map(function (citation) { return citation.citeId; });
    var seen = new Set();
    ordered.forEach(function (citeId) {
      var citation = shared.findStoredCitation(stored, citeId);
      if (!citation || seen.has(citeId)) return;
      seen.add(citeId);
      var row = document.createElement('div');
      row.className = 'citation';
      var body = document.createElement('div');
      body.className = 'citation__body';
      var titles = (citation.items || []).map(function (item) {
        var seq = seqByPaperId.get(item.paperId);
        var prefix = typeof seq === 'number' ? (render && render.kind === 'numeric' ? '[' + seq + '] ' : '') : '';
        return prefix + (item.label || item.paperId);
      });
      var title = document.createElement('div');
      title.className = 'citation__title';
      title.textContent = titles.join('；') || '(空引用)';
      var meta = document.createElement('div');
      meta.className = 'citation__meta';
      meta.textContent = '引用 ' + citeId + (citation.items && citation.items[0] && citation.items[0].locator ? ' · 定位 ' + citation.items[0].locator : '');
      body.appendChild(title);
      body.appendChild(meta);
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-button';
      remove.textContent = '删除';
      remove.addEventListener('click', function () {
        removeCitation(citeId).catch(function (error) {
          log('删除引用失败：' + errorMessage(error));
        });
      });
      row.appendChild(body);
      row.appendChild(remove);
      container.appendChild(row);
    });
    if (container.childElementCount === 0) {
      var empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = '文档里还没有 PaperQuay 引用。';
      container.appendChild(empty);
    }
  }

  /* ---------------------------------------------------------------- 事件 */

  function bindEvents() {
    el('connect-button').addEventListener('click', function () {
      connect(el('connection-input').value);
    });

    el('connection-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') connect(el('connection-input').value);
    });

    el('search-button').addEventListener('click', function () {
      searchPapers();
    });

    el('search-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') searchPapers();
    });

    el('style-select').addEventListener('change', function () {
      state.style = shared.normalizeCitationStyle(el('style-select').value);
    });

    el('apply-style-button').addEventListener('click', function () {
      setSetting(SETTINGS.style, state.style);
      setSetting(SETTINGS.schemaVersion, shared.DOCUMENT_SCHEMA_VERSION);
      saveDocumentSettings().then(function () {
        log('引用样式已设为 ' + state.style + '，正在刷新全文…');
        return refreshCitations({ silent: true });
      }).catch(function (error) {
        log('切换样式失败：' + errorMessage(error));
      });
    });

    el('insert-citation-button').addEventListener('click', function () {
      insertCitation().catch(function (error) {
        log('插入引用失败：' + errorMessage(error));
        setNote(errorMessage(error));
      });
    });

    el('insert-bibliography-button').addEventListener('click', function () {
      insertBibliography().catch(function (error) {
        log('插入参考文献表失败：' + errorMessage(error));
        setNote(errorMessage(error));
      });
    });

    el('refresh-button').addEventListener('click', function () {
      refreshCitations({ silent: false }).catch(function (error) {
        log('刷新失败：' + errorMessage(error));
      });
    });

    el('unlink-button').addEventListener('click', function () {
      unlinkCitations().catch(function (error) {
        log('取消链接失败：' + errorMessage(error));
      });
    });

    el('bibliography-title-input').addEventListener('change', function () {
      state.bibliographyTitle = el('bibliography-title-input').value.trim() || shared.DEFAULT_BIBLIOGRAPHY_TITLE;
    });

    el('superscript-input').addEventListener('change', function () {
      state.superscript = el('superscript-input').checked;
      setSetting(SUPERSCRIPT_KEY, state.superscript ? '1' : '0');
      saveDocumentSettings().then(function () {
        log(state.superscript ? '正文引用将以上标形式呈现，正在刷新…' : '正文引用已恢复为正文大小，正在刷新…');
        return refreshCitations({ silent: true });
      }).catch(function (error) {
        log('切换上标失败：' + errorMessage(error));
      });
    });

    el('bib-heading-input').addEventListener('change', function () {
      state.bibHeading = el('bib-heading-input').checked;
      setSetting(BIB_HEADING_KEY, state.bibHeading ? '1' : '0');
      saveDocumentSettings().then(function () {
        return refreshCitations({ silent: true });
      }).then(function () {
        log(state.bibHeading ? '参考文献表将包含标题行。' : '参考文献表已切换为只有条目列表。');
      }).catch(function (error) {
        log('切换标题行失败：' + errorMessage(error));
      });
    });
  }

  function searchPapers() {
    var query = el('search-input').value.trim();
    var path = '/papers?limit=' + SEARCH_LIMIT + (query ? '&search=' + encodeURIComponent(query) : '');
    return bridgeFetch(path).then(function (result) {
      state.results = Array.isArray(result && result.papers) ? result.papers : [];
      renderSearchResults();
      log('检索到 ' + state.results.length + ' 篇（共 ' + (result ? result.total : 0) + ' 篇匹配）。');
    }).catch(function (error) {
      log('检索失败：' + errorMessage(error));
    });
  }

  function initDocumentState() {
    state.style = styleFromDocument();
    var storedTitle = getSetting(BIBLIOGRAPHY_TITLE_KEY);
    if (typeof storedTitle === 'string' && storedTitle.trim()) {
      state.bibliographyTitle = storedTitle.trim();
      el('bibliography-title-input').value = state.bibliographyTitle;
    }
    state.superscript = getSetting(SUPERSCRIPT_KEY) === '1';
    el('superscript-input').checked = state.superscript;
    state.bibHeading = getSetting(BIB_HEADING_KEY) !== '0';
    el('bib-heading-input').checked = state.bibHeading;
    renderStyleOptions();
    renderCitationList(shared.extractCitationControlTagsFromOoxml(''), null);
  }

  function init() {
    if (!shared) {
      setStatus('共享模块缺失', 'error');
      setNote('未找到 dist/citation-shared.js，请先运行 npm run build:citation。');
      return;
    }
    bindEvents();
    var saved = restoreConnection();
    if (saved) el('connection-input').value = saved;
    Office.onReady(function () {
      initDocumentState();
      if (saved) {
        connect(saved).then(function (ok) {
          if (!ok) return;
          searchPapers();
          refreshCitations({ silent: true }).catch(function (error) {
            log('初始刷新失败：' + errorMessage(error));
          });
        });
      }
    });
  }

  init();
})();
