# PaperQuay v{{VERSION}}

This release completes the library-level RAG status management and knowledge-graph refresh planned on 2026-11-25. RAG index state is now manageable from the library itself, and the graph is a paper-centered semantic network instead of a tag/category hairball.

## What's New

- **RAG status in the library**: the row badge opens build / retry / update / rebuild / details / exclude actions. The paper details panel shows source-level status, chunk counts, embedding model, extractor version, index time, classified errors and cooldown. A new “RAG index status” filter covers indexed, update needed, pending, failed and not built.
- **Selected-paper RAG batches**: build missing, retry failed, update outdated or rebuild selected papers. Candidates and skip reasons are previewed before embedding calls; progress can be paused, resumed or cancelled. Single-paper actions are disabled while a batch runs.
- **Optional automatic retry**: off by default. When enabled it retries only after cooldown and never after auth/billing errors; the attempt counter resets after changing the embedding key/model or a manual retry.
- **Graph view modes**: theme overview (default), focus, mixed and custom. Library context menus, the reader “⋯” menu and the notes context menu can open the graph focused on a paper or note.
- **Semantic graph edges**: document vectors are centered and stripped of the top two components, then edges come from mutual k-NN (K 3–20, default 10) with cross-component bridging. Graph quality reports semantic coverage, degree distribution, components, isolated nodes and hubness.
- **Graph interaction**: collection/type/year/cluster coloring, node shapes and reading-progress rings, hover tooltips, a tabbed inspector explaining why nodes are connected, interactive legend, spotlight search, explicit refresh and persisted node positions.
- **Scale and performance**: 3,000-node / 60-edge-per-node backend defaults, a 50,000-edge render budget, three-tier zoom LOD, a main-process snapshot cache, category aggregation for large graphs, an experimental WebGL switch with software-renderer fallback, and snapshot/layout/first-frame/interaction p50/p95 metrics. Graphs above 1,200 nodes that are not aggregated use a deterministic grid layout to avoid blocking on force layout.

## Fixes

- Tag and collection nodes no longer inflate paper degree, node size or hubness; annotation edges are excluded from graph quality.
- Semantic edges are no longer dominated by the global top 120 near-duplicate pairs.
- Single-paper and batch RAG indexing are mutually exclusive.
- The RAG filter keeps its controls and explains degraded results when the index store is unavailable.
- The details panel shows `lastError` and `rebuildError` separately and offers a runnable MinerU action for unparsed papers.

## Verification

- `npm run typecheck`: six tsc projects, 0 diagnostics.
- `npm run lint`: 0 errors / 205 warnings.
- `npm run build`: passed.
- `npm test`: 1,570 tests, 1,560 passed, 10 skipped, 0 failed.
- Local library copy: 170 valid document vectors, K=10 produced 620 semantic edges, maximum degree 10 and one connected component. Before the change the same library had 9,209 pairs at cosine ≥ 0.82 while the renderer kept only 120 edges.
- A 5,000-node / 25,000-edge headless layout fixture measured about 389 s for fcose, recorded as MIGRATE evidence; the UI therefore uses the grid fallback above 1,200 unaggregated nodes.

## Known Limitations

- Electron desktop acceptance for hover/inspector, position restore, WebGL fallback, LOD and 5k-node pan/zoom is still manual and not part of this automated release verification.
- Advanced citation modes (prior/derivative works, timeline, connect, external citation expansion) are not included; they remain a separate plan.
- Only Windows x64 installers are published and maintained.
