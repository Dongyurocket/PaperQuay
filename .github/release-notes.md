# PaperQuay v{{VERSION}}

This release fixes the two P1 and two P2 defects found by the v0.4.41 desktop acceptance run, unifies the RAG status wording, and hardens the note "unsaved" indicator.

## Fixes

- **Knowledge graph rendered nothing (P1)**: a paper whose reading progress is below 2.5% was marked as having a progress ring while its ring image was an empty string. Cytoscape parses that empty `background-image` mapping and throws `Cannot read properties of null (reading 'value')` while drawing the first element, so the canvas stayed blank with both the Canvas and WebGL renderers. The same error surfaced as `Graph workspace failed to load` when `cy.fit()` ran inside the React effect. `hasProgress` now follows whether the ring image actually exists.
- **"AI models" settings page unreachable (P1)**: the wheel-scroll delegate was mounted only once, before the preferences dialog rendered, so it never attached. It now takes an `enabled` flag and re-attaches when the dialog opens. The section list also gets a stable scrollbar gutter, a darker thumb and extra bottom padding, so the last page stays reachable in short windows.
- **Notes "Task list" button did nothing (P2)**: the button is a ProseMirror formatter, and `toggleTaskList()` silently returns false when the caret sits in an excerpt atom. It now falls back to inserting a new task item, and both the toolbar and the block menu share that entry point.
- **Filtered empty library showed the empty-library copy (P2)**: the list now distinguishes "no papers at all" from "nothing matches", shows "No matching papers" and offers "Clear filters".
- **Note stayed "unsaved" after a successful save**: the content signature now trims `contentText` and normalizes tags exactly the way the data layer stores them, so the reloaded signature can no longer differ from the local one by normalization alone.
- **RAG wording**: the row badge now says "RAG not built" instead of "RAG not indexed", matching the details panel, filter and batch-index entry points.

## Verification

- `npm run typecheck`: six tsc projects, 0 diagnostics.
- `npm run lint`: 0 errors / 205 warnings.
- `npm run build`: passed.
- `npm test`: 1,572 tests, 1,562 passed, 10 skipped, 0 failed.
- New regression tests cover the empty progress ring (including a headless Cytoscape pass that parses `background-image` on every node — the fixture reproduces the v0.4.41 `null.value` throw before the fix) and the filtered-empty library state.
- The v0.4.41 root cause was measured on an isolated profile copy through the DevTools protocol: 196 nodes / 845 edges inside Cytoscape, three canvases with zero non-transparent pixels, and exactly one node with `hasProgress = 1` and an empty ring image at 0.523% progress.

## Not verified in this release

Desktop acceptance on the installed build was not run this round. The following cases therefore remain unverified for v0.4.42:

- Graph canvas on the installed build: node/edge visibility, colour modes, node shapes, semantic K, hover, inspector, search highlight, position persistence, LOD, theme and tab switching, snapshot/layout/first-frame timings.
- Settings dialog: reaching the "AI models" page and the "failed index auto-retry" switch in the installed build.
- Notes task list, filtered-empty library copy, and the unsaved indicator in the installed build.
- Native file-picker import (A3), real Embedding index builds (B5/B6) and the "index store unavailable" state (B9).

## Known limitations

- Only Windows x64 installers are published and maintained.
- Advanced citation modes (prior/derivative works, timeline, connect, external citation expansion) are still not included.
