#!/usr/bin/env node

/**
 * PaperQuay Knowledge Base MCP Server (Stdio)
 *
 * Designed for Proma, Pi, Codex, Claude Code, and any Model Context Protocol compliant agents.
 * Connects read-only to PaperQuay local SQLite databases for fast, conflict-free retrieval.
 */

const readline = require('node:readline');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

// 解析 CLI 参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = { dataDir: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) {
      options.dataDir = args[i + 1];
      i++;
    } else if (args[i].startsWith('--data-dir=')) {
      options.dataDir = args[i].slice('--data-dir='.length);
    }
  }

  return options;
}

const options = parseArgs();
const service = new PaperQuayKnowledgeService({ dataDir: options.dataDir });

const SERVER_NAME = 'paperquay-knowledge-mcp';
const SERVER_VERSION = '0.1.32';

const TOOLS = [
  {
    name: 'search_papers',
    description:
      'Search papers in the PaperQuay literature library by title, Chinese title, authors, publication, DOI, tags, or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in title, author, venue, abstract, or keywords.',
        },
        tag: {
          type: 'string',
          description: 'Filter by a specific tag name.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of papers to return (default 10, max 50).',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_paper_details',
    description:
      'Get complete bibliographic metadata, abstract, notes, citations, and attachments for a specific paper by its paperId.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: {
          type: 'string',
          description: 'The unique ID of the paper in PaperQuay.',
        },
      },
      required: ['paperId'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Full-text and chunk evidence search across the PaperQuay RAG knowledge base. Returns grounded text snippets with paper title, page number, block ID, and relevance score for answering user questions with citations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or concept to look up in the parsed paper text.',
        },
        paperId: {
          type: 'string',
          description: 'Optional paper ID to narrow down search to a single document.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of evidence snippets to return (default 8, max 30).',
          default: 8,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_paper_content',
    description:
      'Read structured content chunks from a paper in the knowledge base, optionally filtered by page index.',
    inputSchema: {
      type: 'object',
      properties: {
        paperId: {
          type: 'string',
          description: 'The unique ID of the paper.',
        },
        pageIndex: {
          type: 'integer',
          description: '0-based page index to read chunks from a specific page.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum chunks to return (default 20, max 100).',
          default: 20,
        },
      },
      required: ['paperId'],
    },
  },
  {
    name: 'search_notes',
    description:
      'Search reading notes, excerpt highlights, and thoughts saved in PaperQuay.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search in note titles and contents.',
        },
        paperId: {
          type: 'string',
          description: 'Filter notes linked to a specific paper ID.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum notes to return (default 10).',
          default: 10,
        },
      },
    },
  },
];

function sendJsonRpc(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sendResult(id, result) {
  sendJsonRpc({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function sendError(id, code, message, data) {
  sendJsonRpc({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
}

async function handleToolCall(name, args) {
  switch (name) {
    case 'search_papers':
      return service.searchPapers(args || {});
    case 'get_paper_details':
      return service.getPaperDetails(args || {});
    case 'search_knowledge_base':
      return service.searchKnowledgeBase(args || {});
    case 'read_paper_content':
      return service.readPaperContent(args || {});
    case 'search_notes':
      return service.searchNotes(args || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const { id, method, params } = message;

  // 通知类消息无须回复 id
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      console.error('[PaperQuay MCP] Client initialized successfully.');
    }
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        sendResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        });
        break;

      case 'ping':
        sendResult(id, {});
        break;

      case 'tools/list':
        sendResult(id, {
          tools: TOOLS,
        });
        break;

      case 'tools/call': {
        const { name, arguments: toolArgs } = params || {};
        if (!name) {
          sendError(id, -32602, 'Tool name is required');
          break;
        }

        try {
          const data = await handleToolCall(name, toolArgs || {});
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(data, null, 2),
              },
            ],
            isError: false,
          });
        } catch (toolError) {
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: `Error executing ${name}: ${toolError.message}`,
              },
            ],
            isError: true,
          });
        }
        break;
      }

      default:
        sendError(id, -32601, `Method not found: ${method}`);
        break;
    }
  } catch (error) {
    console.error('[PaperQuay MCP] Unhandled error:', error);
    sendError(id, -32603, `Internal error: ${error.message}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const json = JSON.parse(trimmed);
    void handleMessage(json);
  } catch (parseError) {
    console.error('[PaperQuay MCP] JSON parse error on input line:', parseError.message);
    sendError(null, -32700, 'Parse error');
  }
});

rl.on('close', () => {
  console.error('[PaperQuay MCP] Stdio stream closed, shutting down.');
  process.exit(0);
});

console.error(`[PaperQuay MCP] Server started (version: ${SERVER_VERSION}, dataDir: ${service.appPaths.dataDir})`);
