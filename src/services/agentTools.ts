import type { LiteraturePaper } from '../types/library';
import type { AgentMemoryFile, AgentMemoryWritePlan } from './agentMemory';
import type {
  AgentToolDefinition,
  AgentToolMountContext,
  AgentToolResult,
} from './agentLoop';
import type {
  LibraryAgentPlan,
  LibraryAgentRagCitation,
  LibraryAgentTool,
  LibraryPaperReviewFigure,
} from './libraryAgent';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : [];
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(max, Math.trunc(number))) : fallback;
}

function paperSearchText(paper: LiteraturePaper): string {
  return [
    paper.title,
    paper.authors.map((author) => author.name).join(' '),
    paper.year,
    paper.publication,
    paper.doi,
    paper.abstractText,
    paper.aiSummary,
    paper.keywords.join(' '),
    paper.tags.map((tag) => tag.name).join(' '),
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

function paperMetadata(paper: LiteraturePaper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors.map((author) => author.name),
    year: paper.year ?? null,
    publication: paper.publication ?? null,
    doi: paper.doi ?? null,
    url: paper.url ?? null,
    abstract: paper.abstractText ?? null,
    keywords: paper.keywords,
    tags: paper.tags.map((tag) => tag.name),
    categoryIds: paper.categoryIds,
  };
}

export interface AgentPaperContextResult {
  text: string;
  source: string;
  citations?: LibraryAgentRagCitation[];
  figures?: LibraryPaperReviewFigure[];
  ragError?: string | null;
}

export interface AgentFigureResult {
  caption: string;
  dataUrl?: string;
  pageIndex?: number;
  blockId?: string;
  kind: string;
}

export interface CreateLibraryAgentToolsOptions {
  papers: LiteraturePaper[];
  getPaperContext?: (
    paper: LiteraturePaper,
    input: { mode: 'summary' | 'pdf-text'; query: string },
  ) => Promise<AgentPaperContextResult>;
  getFigure?: (
    paper: LiteraturePaper,
    input: { blockId?: string; pageIndex?: number },
  ) => Promise<AgentFigureResult | null>;
  createWritePlan: (tool: LibraryAgentTool, args: Record<string, unknown>) => LibraryAgentPlan;
  memory?: {
    read: (file: AgentMemoryFile) => Promise<string>;
    createWritePlan: (input: {
      file: Exclude<AgentMemoryFile, 'trace'>;
      content: string;
      summary: string;
    }) => AgentMemoryWritePlan;
  };
}

function writeToolDefinition(
  tool: LibraryAgentTool,
  description: string,
  createWritePlan: CreateLibraryAgentToolsOptions['createWritePlan'],
): AgentToolDefinition {
  return {
    name: tool,
    description,
    kind: 'write',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              paperId: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              before: { type: 'string' },
              after: { type: 'string' },
              update: { type: 'object' },
              targetCategoryName: { type: 'string' },
              targetCategoryParentName: { type: 'string' },
            },
            required: ['paperId'],
          },
        },
      },
      required: ['summary', 'items'],
    },
    async execute(args) {
      const plan = createWritePlan(tool, args);
      return {
        content: `Created a reviewable ${tool} plan with ${plan.items.length} item(s). No local write has been applied.`,
        plan,
      };
    },
  };
}

export function createLibraryAgentTools(options: CreateLibraryAgentToolsOptions): AgentToolDefinition[] {
  const paperById = new Map(options.papers.map((paper) => [paper.id, paper]));
  const resolvePaper = (value: unknown) => paperById.get(stringValue(value));
  const getContext = options.getPaperContext;

  const tools: AgentToolDefinition[] = [
    {
      name: 'search_library',
      description: 'Search the current PaperQuay library by title, author, tag, abstract, venue, DOI, or year.',
      kind: 'read',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['query'],
      },
      async execute(args): Promise<AgentToolResult> {
        const query = stringValue(args.query).toLocaleLowerCase();
        const limit = boundedInteger(args.limit, 8, 20);
        const matches = query
          ? options.papers.filter((paper) => paperSearchText(paper).includes(query)).slice(0, limit)
          : options.papers.slice(0, limit);

        return {
          content: JSON.stringify({
            matches: matches.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors.map((author) => author.name),
              year: paper.year ?? null,
              tags: paper.tags.map((tag) => tag.name),
            })),
          }),
          cards: [{ kind: 'papers', title: `${matches.length} library matches` }],
        };
      },
    },
    {
      name: 'read_paper_metadata',
      description: 'Read complete bibliographic metadata for one paper by its PaperQuay paper ID.',
      kind: 'read',
      parameters: {
        type: 'object',
        properties: { paperId: { type: 'string' } },
        required: ['paperId'],
      },
      async execute(args) {
        const paper = resolvePaper(args.paperId);

        if (!paper) {
          throw new Error('The requested paper ID is not available in the current library scope.');
        }

        return {
          content: JSON.stringify(paperMetadata(paper)),
          cards: [{ kind: 'papers', title: paper.title }],
        };
      },
    },
    {
      name: 'read_paper_overview',
      description: 'Read the saved PaperQuay overview or abstract for one local-library paper.',
      kind: 'read',
      available: (ctx: AgentToolMountContext) => ctx.localLibraryMode,
      parameters: {
        type: 'object',
        properties: { paperId: { type: 'string' } },
        required: ['paperId'],
      },
      async execute(args) {
        const paper = resolvePaper(args.paperId);

        if (!paper) {
          throw new Error('The requested paper ID is not available in the current library scope.');
        }

        const overview = paper.aiSummary?.trim() || paper.abstractText?.trim();

        if (!overview) {
          return { content: JSON.stringify({ paperId: paper.id, overview: null, status: 'not_available' }) };
        }

        return {
          content: JSON.stringify({ paperId: paper.id, title: paper.title, overview }),
          cards: [{ kind: 'text', title: paper.title, detail: 'Saved overview' }],
        };
      },
    },
    {
      name: 'rag_search',
      description: 'Search selected papers with local RAG and return page-aware evidence snippets.',
      kind: 'read',
      available: (ctx: AgentToolMountContext) => ctx.ragReady,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          paperIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
      },
      async execute(args) {
        if (!getContext) {
          throw new Error('Local RAG context is unavailable for this Agent run.');
        }

        const query = stringValue(args.query);
        const paperIds = stringArray(args.paperIds);
        const targetPapers = paperIds.length > 0
          ? paperIds.map((paperId) => paperById.get(paperId)).filter((paper): paper is LiteraturePaper => Boolean(paper))
          : options.papers;
        const contexts = await Promise.all(targetPapers.map((paper) => getContext(paper, { mode: 'pdf-text', query })));
        const chunks = contexts.flatMap((context, index) => (context.citations ?? []).map((citation) => ({
          paperId: targetPapers[index]?.id,
          page: citation.pageIndex === null || citation.pageIndex === undefined ? null : citation.pageIndex + 1,
          blockId: citation.blockId ?? null,
          snippet: citation.previewText ?? '',
          hasImage: Boolean(context.figures?.some((figure) => figure.blockId && figure.blockId === citation.blockId)),
        })));

        return {
          content: JSON.stringify({ chunks, ragErrors: contexts.map((context) => context.ragError).filter(Boolean) }),
          cards: [{ kind: 'citations', title: `${chunks.length} RAG evidence snippets` }],
        };
      },
    },
    {
      name: 'request_paper_context',
      description: 'Load summary or full paper context for papers already in the current PaperQuay library scope.',
      kind: 'read',
      available: (ctx: AgentToolMountContext) => ctx.papersCount > 0,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['summary', 'pdf-text'] },
          reason: { type: 'string' },
          paperIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['mode', 'reason', 'paperIds'],
      },
      async execute(args) {
        if (!getContext) {
          throw new Error('Paper context loading is unavailable for this Agent run.');
        }

        const mode = args.mode === 'summary' ? 'summary' : 'pdf-text';
        const query = stringValue(args.reason);
        const requestedIds = stringArray(args.paperIds);
        const targetPapers = requestedIds.length > 0
          ? requestedIds.map((paperId) => paperById.get(paperId)).filter((paper): paper is LiteraturePaper => Boolean(paper))
          : options.papers;
        const contexts = await Promise.all(targetPapers.map((paper) => getContext(paper, { mode, query })));

        return {
          content: JSON.stringify({
            mode,
            papers: contexts.map((context, index) => ({
              paperId: targetPapers[index]?.id,
              title: targetPapers[index]?.title,
              source: context.source,
              text: context.text,
            })),
          }),
          cards: [{ kind: 'papers', title: `${contexts.length} paper context result(s)` }],
        };
      },
    },
  ];

  if (options.getFigure) {
    tools.push({
      name: 'read_paper_figure',
      description: 'Read a referenced local paper figure or table by paper ID and block ID or page number.',
      kind: 'read',
      parameters: {
        type: 'object',
        properties: {
          paperId: { type: 'string' },
          blockId: { type: 'string' },
          pageIndex: { type: 'integer', minimum: 0 },
        },
        required: ['paperId'],
      },
      async execute(args) {
        const paper = resolvePaper(args.paperId);

        if (!paper) {
          throw new Error('The requested paper ID is not available in the current library scope.');
        }

        const figure = await options.getFigure?.(paper, {
          blockId: stringValue(args.blockId) || undefined,
          pageIndex: Number.isFinite(Number(args.pageIndex)) ? Math.max(0, Math.trunc(Number(args.pageIndex))) : undefined,
        });

        if (!figure) {
          return { content: JSON.stringify({ paperId: paper.id, figure: null }) };
        }

        return {
          content: JSON.stringify({
            paperId: paper.id,
            caption: figure.caption,
            pageIndex: figure.pageIndex ?? null,
            blockId: figure.blockId ?? null,
            kind: figure.kind,
            imageAvailable: Boolean(figure.dataUrl),
          }),
          attachments: figure.dataUrl ? [{
            id: `agent-figure:${paper.id}:${figure.blockId ?? figure.pageIndex ?? 'figure'}`,
            kind: 'image',
            name: `figure-${paper.id}`,
            mimeType: figure.dataUrl.match(/^data:([^;,]+)/)?.[1] ?? 'image/jpeg',
            size: Math.max(0, Math.floor((figure.dataUrl.split(',')[1]?.length ?? 0) * 3 / 4)),
            dataUrl: figure.dataUrl,
            summary: figure.caption,
          }] : undefined,
          cards: [{ kind: 'figure', title: paper.title, detail: figure.caption }],
        };
      },
    });
  }

  if (options.memory) {
    tools.push(
      {
        name: 'read_memory',
        description: 'Read PaperQuay local Agent memory. Use topics for L2 facts, synthesis for L3 cross-topic conclusions, or trace for today\'s event log.',
        kind: 'read',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', enum: ['trace', 'topics', 'synthesis'] },
          },
          required: ['file'],
        },
        async execute(args) {
          const file = args.file === 'trace' || args.file === 'synthesis' ? args.file : 'topics';
          const content = await options.memory?.read(file);
          return {
            content: JSON.stringify({ file, content: content ?? '' }),
            cards: [{ kind: 'memory', title: `Memory: ${file}` }],
          };
        },
      },
      {
        name: 'write_memory',
        description: 'Create a reviewable update to local Agent L2 topics or L3 synthesis memory. Never writes directly.',
        kind: 'write',
        parameters: {
          type: 'object',
          properties: {
            file: { type: 'string', enum: ['topics', 'synthesis'] },
            summary: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file', 'summary', 'content'],
        },
        async execute(args) {
          const file = args.file === 'synthesis' ? 'synthesis' : 'topics';
          const content = stringValue(args.content);

          if (!content) {
            throw new Error('write_memory requires non-empty content for review.');
          }

          const memoryPlan = options.memory?.createWritePlan({
            file,
            content,
            summary: stringValue(args.summary) || `Update ${file} memory.`,
          });

          if (!memoryPlan) {
            throw new Error('Local Agent memory is unavailable for this run.');
          }

          return {
            content: `Created a reviewable ${file} memory update. No memory file has been modified.`,
            memoryPlan,
          };
        },
      },
    );
  }

  tools.push(
    writeToolDefinition('rename', 'Create a reviewable plan to rename papers. Never apply the plan directly.', options.createWritePlan),
    writeToolDefinition('metadata', 'Create a reviewable plan to update paper metadata. Never apply the plan directly.', options.createWritePlan),
    writeToolDefinition('smart-tags', 'Create a reviewable plan to update paper tags. Never apply the plan directly.', options.createWritePlan),
    writeToolDefinition('clean-tags', 'Create a reviewable plan to clean paper tags. Never apply the plan directly.', options.createWritePlan),
    writeToolDefinition('classify', 'Create a reviewable plan to classify papers. Never apply the plan directly.', options.createWritePlan),
  );

  return tools;
}
