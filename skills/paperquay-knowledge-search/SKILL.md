---
name: paperquay-knowledge-search
description: Search the local PaperQuay literature library, RAG evidence, and reading notes with page- and block-level citations. Use for questions about papers or notes already stored in PaperQuay.
---

# PaperQuay Knowledge Search

Use the `paperquay` MCP server's read-only tools. Consult `docs/MCP_AGENT_INTEGRATION.md` for the current schemas; do not copy its complete schemas here.

## Retrieval Procedure

1. Use `search_papers` to discover paper IDs or narrow a library scope.
2. Use `get_paper_details` only when complete bibliographic metadata or attachments are needed.
3. Use `search_knowledge_base` for evidence; preserve each result's `paperId`, `paperTitle`, page number, `blockId`, retrieval mode, channels, and warning.
4. Use `read_paper_content` to inspect enough surrounding structured text before interpreting a matching snippet.
5. Use `search_notes` only for user-authored notes, and report a keyword fallback or embedding degradation warning when returned.

## Evidence Rules

- Distinguish source text from your synthesis.
- Cite the exact PaperQuay paper title, page and block where available.
- Do not invent a source, page, block, or retrieval result.
- State when keyword retrieval or a degraded mode limits confidence.
- These tools are read-only; library and note modifications belong to their dedicated skills.
