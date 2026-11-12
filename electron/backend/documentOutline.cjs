const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(readText).join('');
  if (value && typeof value === 'object' && typeof value.content === 'string') return value.content;
  return '';
}

function blockText(block) {
  const content = block?.content;
  const candidates = [block?.text, content?.text, content?.title_content, content?.value];
  return candidates.map(readText).find((value) => value.trim())?.trim() || '';
}

function headingFrom(block, physicalPage, order) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const content = block.content && typeof block.content === 'object' ? block.content : {};
  const level = Number(block.text_level ?? content.text_level);
  const title = blockText(block).replace(/\s+/g, ' ');
  if (!Number.isSafeInteger(level) || level < 1 || level > 6 || !title || title.length > 500) return null;
  return { title, level, physicalPage, order };
}

function visitBlocks(parsed, onBlock) {
  if (!Array.isArray(parsed)) return;
  let order = 0;
  const visit = (block, physicalPage) => {
    const found = headingFrom(block, physicalPage, order++);
    if (found) onBlock(found);
  };
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index];
    if (Array.isArray(entry)) {
      entry.forEach((block) => visit(block, index + 1));
    } else if (entry && typeof entry === 'object' && 'type' in entry) {
      const page = Number(entry.page_idx);
      visit(entry, Number.isSafeInteger(page) && page >= 0 ? page + 1 : 1);
    } else if (entry && typeof entry === 'object') {
      Object.values(entry).forEach((block) => visit(block, index + 1));
    }
  }
}

/** Derive a conservative, page-addressable outline; printed pagination stays unknown. */
function deriveDocumentOutline(parsedContentList, { generationId, sourceVersion, pageCount }) {
  if (!generationId || !sourceVersion || !Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new TypeError('A generation, source version, and positive physical page count are required.');
  }
  const candidates = [];
  visitBlocks(parsedContentList, (heading) => {
    if (heading.physicalPage <= pageCount) candidates.push(heading);
  });

  const rootId = `document:${generationId}:root`;
  const units = [{
    unitId: rootId, parentUnitId: null, unitKind: 'document', ordinal: 0,
    title: null, physicalStart: 1, physicalEnd: pageCount,
    printedStart: null, printedEnd: null,
    unitRevision: digest(`${sourceVersion}\0${rootId}\0${pageCount}`),
    contentHash: null, content: null,
  }];
  const headings = [];
  const parentByLevel = new Map();

  candidates.forEach((heading, index) => {
    for (const level of parentByLevel.keys()) if (level >= heading.level) parentByLevel.delete(level);
    const parentLevels = [...parentByLevel.keys()].filter((level) => level < heading.level).sort((left, right) => right - left);
    const parentUnitId = parentByLevel.get(parentLevels[0]) || rootId;
    const unitId = `outline:${generationId}:${index}:${digest(`${heading.title}\0${heading.physicalPage}`).slice(0, 12)}`;
    let physicalEnd = pageCount;
    for (let next = index + 1; next < candidates.length; next += 1) {
      if (candidates[next].level <= heading.level) {
        physicalEnd = Math.max(heading.physicalPage, candidates[next].physicalPage - 1);
        break;
      }
    }
    const unit = {
      unitId,
      parentUnitId,
      unitKind: heading.level === 1 ? 'chapter' : 'section',
      ordinal: index + 1,
      title: heading.title,
      physicalStart: heading.physicalPage,
      physicalEnd,
      printedStart: null,
      printedEnd: null,
      unitRevision: digest(`${sourceVersion}\0${unitId}\0${heading.title}\0${heading.physicalPage}\0${physicalEnd}\0${parentUnitId}`),
      contentHash: null,
      content: null,
    };
    headings.push(unit);
    units.push(unit);
    parentByLevel.set(heading.level, unitId);
  });

  const mappingRevision = digest(`${sourceVersion}\0outline\0${units.map((unit) => `${unit.unitId}:${unit.unitRevision}`).join('|')}`);
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const physicalPage = index + 1;
    const active = headings.filter((unit) => unit.physicalStart <= physicalPage && unit.physicalEnd >= physicalPage);
    const unitId = active.at(-1)?.unitId || rootId;
    return { physicalPage, printedPage: null, unitId, mappingRevision };
  });

  return { units, pages, quality: candidates.length ? 'candidate-outline' : 'page-only', headingCount: candidates.length };
}

module.exports = { deriveDocumentOutline };
