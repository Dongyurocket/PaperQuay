import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import {
  buildReviewBlueprintPrompt,
  buildReviewPartPrompt,
  composeReviewDraftFromGeneratedParts,
  countCompletedReviewGeneratedParts,
  defaultReviewTemplateBuffer,
  normalizeReviewGeneratedParts,
  normalizeReviewJsonDraft,
  normalizeReviewBlueprint,
  prepareReviewDocxData,
  renderReviewDocxTemplate,
} from '../electron/backend/reviewCommands.cjs';

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function minimalDocxXml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function paragraph(text: string) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function writeMinimalDocxTemplate(filePath: string) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
  zip.addFile('word/document.xml', Buffer.from(minimalDocxXml([
    paragraph('{title}'),
    paragraph('{#sections}{heading}: {content}{/sections}'),
  ].join('\n'))));
  await writeFile(filePath, zip.toBuffer());
}

test('normalizeReviewJsonDraft keeps docxtemplater-compatible fields', () => {
  const draft = normalizeReviewJsonDraft({
    title: 'Review',
    sections: [
      { heading: 'Methods', content: 'Synthesis', citations: ['P1', 'missing'] },
    ],
    sources: [{ id: 'P1', title: 'Paper', sourceType: 'paper', relevance: 'related' }],
  });

  assert.equal(draft.title, 'Review');
  assert.deepEqual(draft.sections[0]?.citations, ['P1']);
  assert.equal(draft.sources[0]?.id, 'P1');
});

test('normalizeReviewBlueprint creates paragraph tasks without writing final prose', () => {
  const blueprint = normalizeReviewBlueprint({
    title: 'Multimodal RAG Review',
    keywords: ['RAG', 'paper reading'],
    sections: [
      {
        id: 'theme',
        heading: 'Retrieval and Reading',
        task: 'Plan a section about retrieval-assisted paper reading.',
        evidenceIds: ['P1'],
        paragraphTasks: [
          {
            task: 'Define the research theme.',
            evidenceIds: ['P1', 'missing'],
            retrievalNotes: 'Use the paper context for the definition.',
          },
          {
            task: 'Connect the theme to notes.',
            evidenceIds: ['missing'],
            retrievalNotes: 'Fall back to the section evidence when ids are invalid.',
          },
        ],
      },
    ],
  }, {
    intent: 'Write a review about multimodal RAG for paper reading.',
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'RAG for Paper Reading',
        authors: 'Smith J',
        year: '2025',
        text: 'Retrieval helps readers connect PDF evidence.',
      },
      {
        id: 'N1',
        sourceType: 'note',
        title: 'Reading note',
        text: 'Notes preserve inline reading insights.',
      },
    ],
  });

  assert.equal(blueprint.title, 'Multimodal RAG Review');
  assert.equal(blueprint.sections[0]?.heading, 'Retrieval and Reading');
  assert.equal(blueprint.sections[0]?.paragraphTasks.length, 2);
  assert.deepEqual(blueprint.sections[0]?.paragraphTasks[0]?.evidenceIds, ['P1']);
  assert.deepEqual(blueprint.sections[0]?.paragraphTasks[1]?.evidenceIds, ['P1']);
  assert.match(blueprint.sections[0]?.paragraphTasks[0]?.task ?? '', /Define the research theme/);
});

test('normalizeReviewBlueprint preserves section headings exactly', () => {
  const blueprint = normalizeReviewBlueprint({
    title: 'RAG Review',
    sections: [
      { heading: 'Section 1', task: 'Define the field.', evidenceIds: ['P1'] },
      { heading: 'Methods', task: 'Classify methods.', evidenceIds: ['P1'] },
      { heading: 'Future Work', task: 'Plan future agenda.', evidenceIds: ['P1'] },
    ],
  }, {
    intent: '围绕论文阅读中的 RAG 写中文综述。',
    outputLanguage: 'Chinese',
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'RAG for Paper Reading',
        text: 'Retrieval helps readers connect PDF evidence.',
      },
    ],
  });

  assert.deepEqual(
    blueprint.sections.map((section) => section.heading),
    ['Section 1', 'Methods', 'Future Work'],
  );
});

test('composeReviewDraftFromGeneratedParts merges generated paragraphs into exportable review JSON', () => {
  const contextItems = [
    {
      id: 'P1',
      sourceType: 'paper',
      title: 'RAG for Paper Reading',
      authors: 'Smith J',
      year: '2025',
      doi: '10.1000/rag.1',
      text: 'Retrieval helps readers connect PDF evidence.',
    },
    {
      id: 'N1',
      sourceType: 'note',
      title: 'Reading note',
      text: 'Notes preserve inline reading insights.',
    },
  ];
  const blueprint = normalizeReviewBlueprint({
    title: 'Multimodal RAG Review',
    keywords: ['RAG'],
    intentSummary: 'Review retrieval-assisted paper reading.',
    thesis: 'RAG connects source evidence with reading workflows.',
    abstractTask: { task: 'Write abstract.', evidenceIds: ['P1'] },
    introductionTask: { task: 'Write introduction.', evidenceIds: ['P1'] },
    sections: [
      {
        heading: 'Retrieval and Notes',
        task: 'Synthesize retrieval and note evidence.',
        evidenceIds: ['P1', 'N1'],
        paragraphTasks: [
          { task: 'Write retrieval paragraph.', evidenceIds: ['P1'] },
          { task: 'Write note paragraph.', evidenceIds: ['N1'] },
        ],
      },
    ],
    conclusionTask: { task: 'Write conclusion.', evidenceIds: ['P1', 'N1'] },
  }, {
    intent: 'Write a review about multimodal RAG for paper reading.',
    contextItems,
  });
  const draft = composeReviewDraftFromGeneratedParts({
    blueprint,
    contextItems,
    parts: {
      abstract: { content: 'RAG supports paper reading [P1].', citations: ['P1'] },
      introduction: { content: 'Paper reading benefits from grounded retrieval [P1].', citations: ['P1'] },
      sections: [
        {
          content: 'Retrieval grounds claims in source evidence [P1].\n\nNotes preserve inline insights [N1].',
          citations: ['P1', 'N1'],
          paragraphs: [
            { content: 'Retrieval grounds claims in source evidence [P1].', citations: ['P1'] },
            { content: 'Notes preserve inline insights [N1].', citations: ['N1'] },
          ],
        },
      ],
      comparisonTable: [],
      researchGaps: [],
      futureDirections: [],
      conclusion: { content: 'The workflow depends on retrieval and notes [P1][N1].', citations: ['P1', 'N1'] },
    },
  });

  assert.equal(draft.title, 'Multimodal RAG Review');
  assert.equal(draft.sections[0]?.heading, 'Retrieval and Notes');
  assert.match(draft.sections[0]?.content ?? '', /Retrieval grounds claims/);
  assert.match(draft.sections[0]?.content ?? '', /\n\nNotes preserve inline insights/);
  assert.deepEqual(draft.sections[0]?.citations, ['P1', 'N1']);
  assert.deepEqual(draft.references.map((item) => item.id), ['P1', 'N1']);
  assert.equal(draft.references[0]?.doi, '10.1000/rag.1');
  assert.deepEqual(draft.sources.map((item) => item.id), ['P1', 'N1']);
});

test('normalizeReviewGeneratedParts keeps resumable writing checkpoints by task slot', () => {
  const contextItems = [
    {
      id: 'P1',
      sourceType: 'paper',
      title: 'RAG for Paper Reading',
      text: 'Retrieval helps readers connect PDF evidence.',
    },
    {
      id: 'N1',
      sourceType: 'note',
      title: 'Reading note',
      text: 'Notes preserve inline reading insights.',
    },
  ];
  const blueprint = normalizeReviewBlueprint({
    title: 'Multimodal RAG Review',
    abstractTask: { task: 'Write abstract.', evidenceIds: ['P1'] },
    introductionTask: { task: 'Write introduction.', evidenceIds: ['P1'] },
    sections: [
      {
        heading: 'Retrieval and Notes',
        task: 'Synthesize retrieval and note evidence.',
        evidenceIds: ['P1', 'N1'],
        paragraphTasks: [
          { task: 'Write retrieval paragraph.', evidenceIds: ['P1'] },
          { task: 'Write note paragraph.', evidenceIds: ['N1'] },
        ],
      },
    ],
    comparisonTable: [{ theme: 'Workflow comparison', task: 'Compare workflows.', evidenceIds: ['P1'] }],
    conclusionTask: { task: 'Write conclusion.', evidenceIds: ['P1', 'N1'] },
  }, {
    intent: 'Write a review about multimodal RAG for paper reading.',
    contextItems,
  });
  const validIds = new Set(['P1', 'N1']);
  const parts = normalizeReviewGeneratedParts({
    abstract: { content: 'Saved abstract [P1].', citations: ['P1', 'missing'] },
    sectionParagraphs: [
      [
        { content: 'Saved paragraph [P1].', citations: ['P1'] },
        { content: '', citations: ['N1'] },
      ],
    ],
    comparisonTable: [{ content: 'Saved comparison [P1].', citations: ['P1'] }],
    conclusion: { content: 'Saved conclusion [N1].', citations: ['N1'] },
  }, blueprint, validIds);

  assert.equal(parts.abstract?.content, 'Saved abstract [P1].');
  assert.deepEqual(parts.abstract?.citations, ['P1']);
  assert.equal(parts.sectionParagraphs[0]?.[0]?.content, 'Saved paragraph [P1].');
  assert.equal(parts.sectionParagraphs[0]?.[1], null);
  assert.equal(parts.comparisonTable[0]?.content, 'Saved comparison [P1].');
  assert.equal(parts.conclusion?.content, 'Saved conclusion [N1].');
  assert.equal(countCompletedReviewGeneratedParts(parts), 4);
});

test('prepareReviewDocxData converts internal source IDs to formal numeric citations', () => {
  const draft = prepareReviewDocxData({
    title: 'Review',
    abstract: 'Learning-based methods are important [P1].',
    sections: [
      {
        heading: 'Methods',
        content: 'Deep reinforcement learning improves routing decisions [P1].',
        citations: ['P1', 'P2'],
      },
    ],
    references: [
      {
        id: 'P1',
        title: 'Learning for Vehicle Routing',
        authors: 'Smith J; Chen L',
        year: '2024',
        doi: '10.1000/vrp.1',
      },
      {
        id: 'P2',
        title: 'Dynamic Routing Survey',
        authors: 'Wang K',
        year: '2023',
      },
    ],
    sources: [
      { id: 'P1', title: 'Learning for Vehicle Routing', sourceType: 'paper', relevance: 'routing method' },
      { id: 'P2', title: 'Dynamic Routing Survey', sourceType: 'paper', relevance: 'survey' },
    ],
  });

  assert.equal(draft.abstract, 'Learning-based methods are important [1].');
  assert.equal(draft.sections[0]?.content, 'Deep reinforcement learning improves routing decisions [1].');
  assert.equal(draft.sections[0]?.citationText, '[2]');
  assert.equal(draft.references[0]?.label, '[1]');
  assert.match(draft.references[0]?.formattedText ?? '', /Smith J; Chen L\. Learning for Vehicle Routing\. 2024\. DOI: 10\.1000\/vrp\.1\./);
  assert.equal(draft.references[1]?.label, '[2]');
});

test('prepareReviewDocxData splits body sections into consistently formatted paragraphs', () => {
  const draft = prepareReviewDocxData({
    title: 'Review',
    sections: [
      {
        heading: 'Evidence Synthesis',
        content: 'The first paragraph introduces the evidence [P1].\n\nThe second paragraph compares the evidence.',
        citations: ['P1', 'P2'],
      },
    ],
    references: [
      { id: 'P1', title: 'Paper One', authors: 'Author A', year: '2025' },
      { id: 'P2', title: 'Paper Two', authors: 'Author B', year: '2024' },
    ],
    sources: [
      { id: 'P1', title: 'Paper One', sourceType: 'paper', relevance: 'primary evidence' },
      { id: 'P2', title: 'Paper Two', sourceType: 'paper', relevance: 'comparison evidence' },
    ],
  });

  assert.equal(draft.sections[0]?.paragraphs.length, 2);
  assert.equal(draft.sections[0]?.paragraphs[0]?.text, 'The first paragraph introduces the evidence [1].');
  assert.equal(draft.sections[0]?.paragraphs[0]?.citationText, '');
  assert.equal(draft.sections[0]?.paragraphs[1]?.text, 'The second paragraph compares the evidence.');
  assert.equal(draft.sections[0]?.paragraphs[1]?.citationText, '[2]');
});

test('prepareReviewDocxData removes model image placeholders from prose', () => {
  const draft = prepareReviewDocxData({
    title: 'Image Placeholder Review',
    abstract: '[Image #1]\nThis abstract should start with prose [P1].',
    sections: [
      {
        heading: 'Visual Evidence',
        content: '[Image #1]\n\nThe workflow is summarized in the figure [P1].',
        citations: ['P1'],
      },
    ],
    references: [
      { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
    ],
    sources: [
      { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
    ],
  });

  assert.equal(draft.abstract, 'This abstract should start with prose [1].');
  assert.equal(draft.sections[0]?.content, 'The workflow is summarized in the figure [1].');
  assert.doesNotMatch(draft.sections[0]?.paragraphs[0]?.text ?? '', /\[Image #1\]/);
});

test('prepareReviewDocxData places anchored figures inside body paragraphs', () => {
  const draft = prepareReviewDocxData({
    title: 'Anchored Figure Review',
    sections: [
      {
        id: 'section-1',
        heading: 'Visual Evidence',
        content: 'The workflow evidence is summarized in [Figure: P1-F1] and supports the synthesis [P1].\n\nThe second paragraph remains prose.',
        citations: ['P1'],
      },
    ],
    references: [
      { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
      { id: 'P2', title: 'Unused Figure Paper', authors: 'Author B', year: '2024' },
    ],
    sources: [
      { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
      { id: 'P2', title: 'Unused Figure Paper', sourceType: 'paper', relevance: 'unused visual evidence' },
    ],
    figures: [
      {
        id: 'P1-F1',
        sourceId: 'P1',
        caption: 'Workflow overview.',
        path: 'C:\\tmp\\workflow.png',
        kind: 'image',
      },
      {
        id: 'P2-F1',
        sourceId: 'P2',
        caption: 'Unused evidence.',
        path: 'C:\\tmp\\unused.png',
        kind: 'image',
      },
    ],
  }, 'English');

  assert.equal(draft.sections[0]?.content, 'The workflow evidence is summarized in and supports the synthesis [1].\n\nThe second paragraph remains prose.');
  assert.equal(draft.sections[0]?.paragraphs.length, 2);
  assert.equal(draft.sections[0]?.paragraphs[0]?.text, 'The workflow evidence is summarized in Figure 1 and supports the synthesis [1].');
  assert.equal(draft.sections[0]?.paragraphs[0]?.inlineFigures.length, 1);
  assert.equal(draft.sections[0]?.paragraphs[0]?.inlineFigures[0]?.id, 'P1-F1');
  assert.equal(draft.sections[0]?.paragraphs[1]?.text, 'The second paragraph remains prose.');
  assert.equal(draft.remainingFigures.length, 1);
  assert.equal(draft.remainingFigures[0]?.id, 'P2-F1');
});

test('prepareReviewDocxData places figures by blueprint section placement when no anchor is present', () => {
  const draft = prepareReviewDocxData({
    title: 'Placement Figure Review',
    sections: [
      {
        id: 'section-1',
        heading: 'Visual Evidence',
        content: 'The workflow evidence supports the synthesis [P1].',
        citations: ['P1'],
      },
      {
        id: 'section-2',
        heading: 'Other Evidence',
        content: 'Other evidence is summarized [P2].',
        citations: ['P2'],
      },
    ],
    references: [
      { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
      { id: 'P2', title: 'Other Paper', authors: 'Author B', year: '2024' },
    ],
    sources: [
      { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
      { id: 'P2', title: 'Other Paper', sourceType: 'paper', relevance: 'other evidence' },
    ],
    figures: [
      {
        id: 'P1-F1',
        sourceId: 'P1',
        caption: 'Workflow overview.',
        path: 'C:\\tmp\\workflow.png',
        kind: 'image',
        placement: 'section-1',
      },
    ],
  }, 'English');

  assert.equal(draft.sections[0]?.paragraphs[0]?.inlineFigures[0]?.id, 'P1-F1');
  assert.equal(draft.sections[1]?.paragraphs[0]?.inlineFigures.length, 0);
  assert.equal(draft.remainingFigures.length, 0);
  assert.equal(draft.hasRemainingFigures, false);
});

test('renderReviewDocxTemplate renders strict JSON into a docx template', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-'));
  const templatePath = path.join(dir, 'template.docx');
  const outputPath = path.join(dir, 'output.docx');

  try {
    await writeMinimalDocxTemplate(templatePath);
    const result = await renderReviewDocxTemplate({
      templatePath,
      outputPath,
      data: {
        title: 'Generated Review',
        sections: [{ heading: 'Methods', content: 'The methods are synthesized.' }],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.equal(result.outputPath, outputPath);
    assert.ok(result.byteSize > 0);
    assert.match(documentXml, /Generated Review/);
    assert.match(documentXml, /Methods: The methods are synthesized\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderReviewDocxTemplate uses the built-in template when no custom template is selected', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-default-'));
  const outputPath = path.join(dir, 'output.docx');

  try {
    const result = await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Built-in Review',
        abstract: 'Generated from strict JSON.',
        sections: [{ heading: 'Findings', content: 'The findings are grounded in retrieved context.' }],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.equal(result.outputPath, outputPath);
    assert.ok(result.byteSize > 0);
    assert.match(documentXml, /Built-in Review/);
    assert.match(documentXml, /Generated from strict JSON/);
    assert.match(documentXml, /Findings/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template renders formal citations and readable academic layout', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-citation-'));
  const outputPath = path.join(dir, 'output.docx');

  try {
    const result = await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Vehicle Routing Review',
        abstract: 'Learning methods have become important for VRP [P1].',
        keywords: ['VRP', 'Deep learning'],
        intentSummary: 'Review routing methods for researchers.',
        thesis: 'Learning and dynamic coordination are central trends.',
        introduction: 'VRP research is expanding toward dynamic scenarios [P1].',
        sections: [
          {
            heading: 'Learning Methods',
            content: 'Transformer and reinforcement learning methods improve search quality [P1].',
            citations: ['P1', 'P2'],
          },
        ],
        comparisonTable: [
          {
            theme: 'Method route',
            papers: ['P1', 'P2'],
            conclusion: 'Learning-based solvers improve adaptation.',
          },
        ],
        researchGaps: ['Evaluation protocols remain inconsistent [P2].'],
        futureDirections: ['Future work should strengthen real-world constraints [P2].'],
        conclusion: 'The field is moving toward scalable and adaptive systems [P1].',
        references: [
          {
            id: 'P1',
            title: 'Learning for Vehicle Routing',
            authors: 'Smith J; Chen L',
            year: '2024',
            doi: '10.1000/vrp.1',
          },
          {
            id: 'P2',
            title: 'Dynamic Routing Survey',
            authors: 'Wang K',
            year: '2023',
          },
        ],
        sources: [
          { id: 'P1', title: 'Learning for Vehicle Routing', sourceType: 'paper', relevance: 'method evidence' },
          { id: 'P2', title: 'Dynamic Routing Survey', sourceType: 'paper', relevance: 'survey evidence' },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.equal(result.outputPath, outputPath);
    assert.ok(result.byteSize > 0);
    assert.match(documentXml, /Vehicle Routing Review/);
    assert.match(documentXml, /<w:jc w:val="center"\/>/);
    assert.match(documentXml, /<w:ind w:firstLine="480"\/>/);
    assert.match(documentXml, /Learning methods have become important for VRP \[1\]\./);
    assert.match(documentXml, /\[1\] Smith J; Chen L\. Learning for Vehicle Routing\. 2024\. DOI: 10\.1000\/vrp\.1\./);
    assert.match(documentXml, /\[2\] Wang K\. Dynamic Routing Survey\. 2023\./);
    assert.doesNotMatch(documentXml, /\[P1\]|\[P2\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template renders separate body paragraphs with matching indentation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-paragraphs-'));
  const outputPath = path.join(dir, 'output.docx');

  try {
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Paragraph Formatting Review',
        sections: [
          {
            heading: 'Evidence Synthesis',
            content: 'The first paragraph introduces the evidence [P1].\n\nThe second paragraph compares the evidence [P2].',
            citations: ['P1', 'P2'],
          },
        ],
        references: [
          { id: 'P1', title: 'Paper One', authors: 'Author A', year: '2025' },
          { id: 'P2', title: 'Paper Two', authors: 'Author B', year: '2024' },
        ],
        sources: [
          { id: 'P1', title: 'Paper One', sourceType: 'paper', relevance: 'primary evidence' },
          { id: 'P2', title: 'Paper Two', sourceType: 'paper', relevance: 'comparison evidence' },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');
    const firstParagraphIndex = documentXml.indexOf('The first paragraph introduces the evidence [1].');
    const secondParagraphIndex = documentXml.indexOf('The second paragraph compares the evidence [2].');

    assert.ok(firstParagraphIndex > 0);
    assert.ok(secondParagraphIndex > firstParagraphIndex);
    assert.ok(documentXml.slice(firstParagraphIndex, secondParagraphIndex).includes('</w:p>'));
    assert.ok((documentXml.match(/<w:ind w:firstLine="480"\/>/g) ?? []).length >= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template renders separate introduction paragraphs with indentation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-introduction-paragraphs-'));
  const outputPath = path.join(dir, 'output.docx');

  try {
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Introduction Formatting Review',
        introduction: 'The first introduction paragraph frames the problem [P1].\n\nThe second introduction paragraph narrows the scope [P1].',
        sections: [{ heading: 'Evidence Synthesis', content: 'The body remains concise [P1].', citations: ['P1'] }],
        references: [
          { id: 'P1', title: 'Paper One', authors: 'Author A', year: '2025' },
        ],
        sources: [
          { id: 'P1', title: 'Paper One', sourceType: 'paper', relevance: 'primary evidence' },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');
    const firstParagraphIndex = documentXml.indexOf('The first introduction paragraph frames the problem [1].');
    const secondParagraphIndex = documentXml.indexOf('The second introduction paragraph narrows the scope [1].');

    assert.ok(firstParagraphIndex > 0);
    assert.ok(secondParagraphIndex > firstParagraphIndex);
    assert.ok(documentXml.slice(firstParagraphIndex, secondParagraphIndex).includes('</w:p>'));
    assert.ok((documentXml.match(/<w:ind w:firstLine="480"\/>/g) ?? []).length >= 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderReviewDocxTemplate converts LaTeX formulas to OMML math', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-omml-'));
  const outputPath = path.join(dir, 'output.docx');

  try {
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Formula Review',
        abstract: 'Inline energy $E=mc^2$ is editable.',
        intentSummary: '$$\\frac{a}{b}$$',
        sections: [
          {
            heading: 'Formula Section',
            content: 'Mixed text with $\\alpha+\\beta$ inline math.',
            citations: [],
          },
        ],
        references: [],
        sources: [],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.match(documentXml, /<m:oMath/);
    assert.match(documentXml, /<m:oMathPara>/);
    assert.doesNotMatch(documentXml, /\$E=mc\^2\$/);
    assert.doesNotMatch(documentXml, /\$\$\\frac\{a\}\{b\}\$\$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template preserves blueprint section headings exactly', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-heading-'));
  const outputPath = path.join(dir, 'output.docx');
  const expectedHeading = '证据对齐与引文约束的综合生成';

  try {
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Heading Review',
        sections: [
          {
            heading: expectedHeading,
            content: 'The generated prose should keep the planned heading unchanged [P1].',
            citations: ['P1'],
          },
        ],
        references: [
          { id: 'P1', title: 'Paper One', authors: 'Author A', year: '2025' },
        ],
        sources: [
          { id: 'P1', title: 'Paper One', sourceType: 'paper', relevance: 'primary evidence' },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.match(documentXml, new RegExp(expectedHeading));
    assert.doesNotMatch(documentXml, /概念基础与综述范围|理论视角与分析框架|方法谱系与代表性进展/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template embeds selected MinerU figure assets into docx media', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-figure-'));
  const imagePath = path.join(dir, 'figure.png');
  const outputPath = path.join(dir, 'output.docx');

  try {
    await writeFile(imagePath, Buffer.from(tinyPngBase64, 'base64'));
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Figure Review',
        sections: [
          {
            heading: 'Visual Evidence',
            content: 'The visual evidence summarizes the workflow [P1].',
            citations: ['P1'],
          },
        ],
        references: [
          { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
        ],
        sources: [
          { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
        ],
        figures: [
          {
            id: 'P1-F1',
            sourceId: 'P1',
            caption: 'Workflow overview from MinerU extraction.',
            path: imagePath,
            kind: 'image',
            pageIndex: 0,
          },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');
    const relsXml = outputZip.readAsText('word/_rels/document.xml.rels');

    assert.ok(outputZip.getEntry('word/media/paperquay-review-figure-1.png'));
    assert.match(relsXml, /rIdPaperQuayFigure1/);
    assert.match(relsXml, /Target="media\/paperquay-review-figure-1\.png"/);
    assert.match(documentXml, /<w:drawing>/);
    assert.match(documentXml, /r:embed="rIdPaperQuayFigure1"/);
    assert.match(documentXml, /<wp:extent cx="9525" cy="9525"\/>/);
    assert.match(documentXml, /Figure Review/);
    assert.match(documentXml, /Visual Evidence/);
    assert.match(documentXml, /The visual evidence summarizes the workflow \[1\]\./);
    assert.match(documentXml, /图 1\. Workflow overview from MinerU extraction\. \[1\]/);
    assert.doesNotMatch(documentXml, /__PAPERQUAY_REVIEW_FIGURE_1__/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template embeds anchored figures near body content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-inline-figure-'));
  const imagePath = path.join(dir, 'figure.png');
  const appendixImagePath = path.join(dir, 'appendix-figure.png');
  const outputPath = path.join(dir, 'output.docx');

  try {
    await writeFile(imagePath, Buffer.from(tinyPngBase64, 'base64'));
    await writeFile(appendixImagePath, Buffer.from(tinyPngBase64, 'base64'));
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Inline Figure Review',
        sections: [
          {
            id: 'section-1',
            heading: 'Visual Evidence',
            content: 'The visual evidence summarizes the workflow [Figure: P1-F1] and supports the synthesis [P1].\n\nThe second paragraph stays indented.',
            citations: ['P1'],
          },
        ],
        references: [
          { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
          { id: 'P2', title: 'Appendix Paper', authors: 'Author B', year: '2024' },
        ],
        sources: [
          { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
          { id: 'P2', title: 'Appendix Paper', sourceType: 'paper', relevance: 'appendix visual evidence' },
        ],
        figures: [
          {
            id: 'P1-F1',
            sourceId: 'P1',
            caption: 'Workflow overview from MinerU extraction.',
            path: imagePath,
            kind: 'image',
          },
          {
            id: 'P2-F1',
            sourceId: 'P2',
            caption: 'Additional appendix figure.',
            path: appendixImagePath,
            kind: 'image',
          },
        ],
        outputLanguage: 'English',
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.ok(outputZip.getEntry('word/media/paperquay-review-figure-1.png'));
    assert.ok(outputZip.getEntry('word/media/paperquay-review-figure-2.png'));
    assert.doesNotMatch(documentXml, /\[Figure: P1-F1\]/);
    assert.match(documentXml, /The visual evidence summarizes the workflow Figure 1 and supports the synthesis \[1\]\./);
    assert.match(documentXml, /The second paragraph stays indented\./);

    const inlineTextIndex = documentXml.indexOf('The visual evidence summarizes the workflow Figure 1');
    const firstDrawingIndex = documentXml.indexOf('r:embed="rIdPaperQuayFigure1"');
    const secondParagraphIndex = documentXml.indexOf('The second paragraph stays indented.');
    const figuresHeadingIndex = documentXml.indexOf('Figures');
    const secondDrawingIndex = documentXml.indexOf('r:embed="rIdPaperQuayFigure2"');

    assert.ok(inlineTextIndex >= 0);
    assert.ok(firstDrawingIndex > inlineTextIndex);
    assert.ok(secondParagraphIndex > firstDrawingIndex);
    assert.ok(figuresHeadingIndex > secondParagraphIndex);
    assert.ok(secondDrawingIndex > figuresHeadingIndex);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('built-in review template cites figure source even when body text does not cite it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-figure-source-'));
  const imagePath = path.join(dir, 'figure.png');
  const outputPath = path.join(dir, 'output.docx');

  try {
    await writeFile(imagePath, Buffer.from(tinyPngBase64, 'base64'));
    await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Figure Source Review',
        sections: [
          {
            heading: 'Visual Evidence',
            content: 'The visual evidence summarizes the workflow.',
            citations: [],
          },
        ],
        references: [
          { id: 'P1', title: 'Workflow Paper', authors: 'Author A', year: '2025' },
        ],
        sources: [
          { id: 'P1', title: 'Workflow Paper', sourceType: 'paper', relevance: 'visual evidence' },
        ],
        figures: [
          {
            id: 'P1-F1',
            sourceId: 'P1',
            caption: 'Workflow overview from MinerU extraction.',
            path: imagePath,
            kind: 'image',
            pageIndex: 0,
          },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.match(documentXml, /图 1\. Workflow overview from MinerU extraction\. \[1\]/);
    assert.match(documentXml, /\[1\] Author A\. Workflow Paper\. 2025\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderReviewDocxTemplate skips selected figure when file is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-missing-figure-'));
  const outputPath = path.join(dir, 'output.docx');
  const missingPath = path.join(dir, 'missing.png');

  try {
    const result = await renderReviewDocxTemplate({
      templatePath: '',
      outputPath,
      data: {
        title: 'Missing Figure Review',
        sections: [{ heading: 'Visual Evidence', content: 'Figure evidence.', citations: [] }],
        figures: [
          {
            id: 'P1-F1',
            sourceId: 'P1',
            caption: 'Missing figure.',
            path: missingPath,
            kind: 'image',
          },
        ],
      },
    });
    const outputZip = new AdmZip(await readFile(outputPath));
    const documentXml = outputZip.readAsText('word/document.xml');

    assert.equal(result.skippedFigures?.length, 1);
    assert.match(result.skippedFigures?.[0]?.reason ?? '', /P1-F1 image file cannot be found/);
    assert.match(documentXml, /\[图片加载失败: P1-F1\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('normalizeReviewBlueprint carries retrieved figure assets into the outline by default', () => {
  const blueprint = normalizeReviewBlueprint({
    title: 'Figure-Aware Review',
    sections: [
      {
        heading: 'Visual Evidence Integration',
        task: 'Explain how visual evidence supports the synthesis.',
        evidenceIds: ['P1'],
      },
    ],
  }, {
    intent: 'Write a review and include useful figures.',
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'Workflow Paper',
        text: 'The paper includes a workflow diagram.',
        figures: [
          {
            id: 'P1-F1',
            sourceId: 'P1',
            caption: 'Workflow overview from MinerU extraction.',
            path: 'C:\\tmp\\figure.png',
            kind: 'image',
          },
        ],
      },
    ],
  });

  assert.equal(blueprint.figures.length, 1);
  assert.equal(blueprint.figures[0]?.id, 'P1-F1');
  assert.equal(blueprint.figures[0]?.path, 'C:\\tmp\\figure.png');
});

test('renderReviewDocxTemplate reports invalid custom templates clearly', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-review-invalid-'));
  const templatePath = path.join(dir, 'empty.docx');
  const outputPath = path.join(dir, 'output.docx');

  try {
    await writeFile(templatePath, Buffer.alloc(0));
    await assert.rejects(
      renderReviewDocxTemplate({
        templatePath,
        outputPath,
        data: { title: 'Review' },
      }),
      /not a valid \.docx Word file/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('defaultReviewTemplateBuffer creates a readable docx package', () => {
  const zip = new AdmZip(defaultReviewTemplateBuffer());
  const documentXml = zip.readAsText('word/document.xml');

  assert.match(documentXml, /{title}/);
  assert.match(documentXml, /{#sections}/);
});

test('buildReviewBlueprintPrompt includes strict JSON example and scholarly review rules', () => {
  const messages = buildReviewBlueprintPrompt({
    intent: '写一篇关于论文阅读 RAG 的中文综述',
    reviewType: '系统综述',
    sourceScope: '文献 + 笔记',
    targetAudience: '研究生和科研工作者',
    outputLanguage: 'Chinese',
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'RAG for Paper Reading',
        authors: 'Smith J',
        year: '2025',
        text: 'Retrieval-grounded paper reading connects document parsing and note synthesis.',
      },
    ],
  });
  const systemPrompt = messages[0]?.content ?? '';
  const userPayload = JSON.parse(messages[1]?.content ?? '{}');

  assert.match(systemPrompt, /rigorous academic writing plan/);
  assert.match(systemPrompt, /high-quality scholarly literature reviews/);
  assert.match(systemPrompt, /requiredBlueprintShape/);
  assert.equal(userPayload.requiredBlueprintShape.title, 'Retrieval-Augmented Scholarly Reading: Foundations, Workflows, and Research Agenda');
  assert.equal(userPayload.requiredBlueprintShape.sections[0].paragraphTasks.length, 2);
  assert.equal(userPayload.contextItems[0].id, 'P1');
});

test('buildReviewPartPrompt includes academic prose output example', () => {
  const blueprint = normalizeReviewBlueprint({
    title: 'RAG Review',
    intentSummary: 'Review RAG for paper reading.',
    thesis: 'RAG connects retrieval and scholarly reading.',
    sections: [
      {
        id: 'section-1',
        heading: 'Conceptual Foundations and Review Scope',
        task: 'Define the scope.',
        evidenceIds: ['P1'],
        paragraphTasks: [
          { id: 'paragraph-1', task: 'Write a paragraph defining the scope.', evidenceIds: ['P1'] },
        ],
      },
    ],
  }, {
    intent: 'Write a review about RAG for paper reading.',
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'RAG for Paper Reading',
        text: 'Retrieval helps readers connect PDF evidence.',
      },
    ],
  });
  const task = blueprint.sections[0].paragraphTasks[0];
  const messages = buildReviewPartPrompt({
    options: { outputLanguage: 'English' },
    blueprint,
    kind: 'section_paragraph',
    heading: blueprint.sections[0].heading,
    task,
    contextItems: [
      {
        id: 'P1',
        sourceType: 'paper',
        title: 'RAG for Paper Reading',
        text: 'Retrieval helps readers connect PDF evidence.',
      },
    ],
  });
  const systemPrompt = messages[0]?.content ?? '';
  const userPayload = JSON.parse(messages[1]?.content ?? '{}');

  assert.match(systemPrompt, /polished academic prose/);
  assert.match(systemPrompt, /contrast, convergence, limitation, implication, and research gap/);
  assert.deepEqual(userPayload.outputExample.citations, ['P1', 'P2']);
  assert.match(userPayload.outputExample.content, /\[P1\]/);
});
