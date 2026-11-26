# PaperQuay v{{VERSION}}

This release fixes the knowledge-graph layout that v0.4.42 rendered as a single diagonal line, and records the v0.4.42 defects as verified on the installed build.

v0.4.42 removed the graph crash: nodes and edges were drawn again. But every node ended up with `x === y` — 196 nodes, 180 in the main component with a secondary-axis standard deviation of literally 0 — so the whole graph collapsed onto a 45° line with overlapping labels. The cause was a layout option, not the renderer: `buildFcoseLayoutOptions` always passed `randomize: false`, and fcose treats that as pure-incremental mode, relaxing existing springs without any spectral placement. When the starting configuration is collinear (all zeros, or the worker's golden-angle spiral degenerating), the result stays one-dimensional.

## Fixes

- **Collapsed graph layout (P1)**: full layouts now use `randomize: true`, so fcose performs its own spectral placement. Incremental refreshes keep `randomize: false`, so adding nodes does not reshuffle the existing graph. The local subgraph view and the main-thread fallback share the same option builder and recover two-dimensional spread with it.
- **Initial-position semantics**: the worker's golden-angle spiral is now documented as the relaxation start for incremental layouts only; full layouts are placed by the spectral pass.

## Verification

- `npm run typecheck`: six tsc projects, 0 diagnostics.
- `npm run lint`: 0 errors / 205 warnings.
- `npm run build`: passed.
- `npm test`: 1,573 tests, 1,563 passed, 10 skipped, 0 failed.
- New `tests/graphLayoutDegenerate.test.ts` runs a real fcose layout and asserts two-dimensional spread (secondary/major axis > 0.05). With the v0.4.42 options the same fixture measures 0.000; with the fix it measures 0.927.
- `tests/graphLayout.test.ts` now pins `randomize: true` for full layouts and `randomize: false` for incremental refreshes.

## Verified on the installed build (v0.4.42 code, isolated profile copy)

Running against the installed app with an isolated profile copy (`%TEMP%\pq-accept-042`), through the DevTools protocol and native window input:

- **Graph renders**: 196 nodes / 845 edges drawn, three canvases with 2,056 non-transparent pixels, first frame 124 ms, no error boundary.
- **Settings**: the section list scrolls to the end (scrollTop 349 of 349), the last page stays fully visible above the footer, the scrollbar is 10 px wide, and the "AI models" page opens.
- **Notes task list**: a normal paragraph converts to a task list, and pressing the button with the caret inside an excerpt atom inserts a new task item (task lists 1 → 2).
- **Filtered empty library**: both a zero-result search and a "RAG not built" filter show "No matching papers" with a "Clear filters" action.
- **Unsaved indicator**: appears on edit, clears after save, and also clears when the edit is undone back to the saved state.
- **RAG wording**: row badge, filter option and inspector agree on "RAG not built" / "not built (includes unparsed)".
- **Graph interactions**: colouring by year, semantic K 10 → 6 (845 → 569 edges), search highlight (11 matches / 185 dimmed), node inspector, hover card, LOD (0 hidden edges at zoom 1.2, 223 at 0.4), position persistence across reload, dark theme, local subgraph (15 nodes / 41 edges). Performance: snapshot 1134 ms · elements 124 ms · layout 1015 ms · first frame 124 ms · interaction frames p50 6.3 ms / p95 6.5 ms.

## Not verified in this release

These cases were not exercised this round:

- The v0.4.43 installer itself: the layout fix is covered by the headless fcose regression test and the option assertions, not by a fresh desktop acceptance run. Confirm two-dimensional spread after installing.
- Real Embedding index builds (B5/B6).
- Native file-picker import (A3) and the "index store unavailable" state (B9).

## Known limitations

- Only Windows x64 installers are published and maintained.
- Advanced citation modes (prior/derivative works, timeline, connect, external citation expansion) are still not included.
