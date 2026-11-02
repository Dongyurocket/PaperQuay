# PaperQuay v{{VERSION}}

A UI consistency pass across the whole app, plus a fix for a library bug that made paper titles disappear.

## Library

- **Paper cards no longer lose their title.** The card grid used a fixed-column layout whose fallback breakpoint was a *viewport* media query, but the list column is sized by the three-pane layout, not the viewport. After widening the category or details panel the breakpoint never fired, the fixed columns ate 372–404px, and in a 445px list the title column was left with 41–73px — titles, authors and file paths were truncated to nothing while badges stacked vertically and each card grew to ~300px of mostly empty space. Cards now use container queries and drop secondary columns as space shrinks; the title column is back to 354px and cards are 165px tall. Narrowing the window to its minimum width no longer collapses the list either.

## Reading

- Assistant sidebar, Q&A sessions and notes state moved out of the reader shell into their own stores. `DocumentReaderTab` went from 62 props to 11. No visible change intended — this is groundwork for keeping the reader maintainable.
- The bridge registry was **not** migrated: extracting it reproduced a real-desktop React "maximum update depth" loop, so it keeps its original lifecycle semantics.
- The reader's two different "dual pane" controls were renamed apart: the PDF layout switch is now "Single PDF / PDF dual pane", and the text column switch is "Original + Translation".

## Knowledge graph

- Node labels are thinned out by importance. Previously every node drew a 9px label, so a 191-node graph turned into overlapping text noise; now only the top ~20% hubs are labelled at the overview level, the selected node is always labelled, and all labels return once you zoom past 1.15×.
- Resizing the window (or maximizing) re-fits the graph instead of leaving it stranded in the corner, and the canvas gained zoom / fit buttons plus a node-type legend.

## Notes

- The graph toggle no longer covers the note title.
- Untranslated English labels (`Saved`, `Backlinks`, `No backlinks`, `Template`, `Search`) now follow the interface language.
- The word count reports characters for Chinese notes instead of a meaningless "67 words".
- The always-visible "Saved" text and "Save" button no longer compete; the button only appears when there is something to save.

## Agent

- **Clearing history now asks for confirmation.** It used to delete every session on a single click, and deleting one session had no confirmation either.
- The session list gained search, date grouping (today / yesterday / previous 7 days / earlier), two-line titles, and a localized usage figure instead of `585k tok`.

## Settings

- Removed the duplicated "Settings" heading, moved the sync interval unit inside its input, and labelled the citation-format dropdown.

## Under the hood

- **Design tokens are enforced.** 1181 hardcoded Tailwind palette classes were replaced with semantic tokens, and the `.pq-saas-scope` selector-patching layer was deleted — it had been forcing hardcoded classes back to token values in CSS, hiding the drift from code review.
- **Brand and status colours are now distinguishable.** In the light theme the accent (`#0d9488`) and success (`#059669`) greens were 13° apart in hue with nearly identical lightness, so "MinerU parsed" and "RAG indexed" badges looked like the same colour. Success moved to a true green (142°), and the dark theme accent is now the same hue family as the light one instead of a desaturated grey-green.
- **Shared UI primitives**: toast notifications (with screen-reader announcements), a global long-task bar, `Dialog`/`ConfirmDialog`, a promise-based confirm host, a single context-menu implementation, and a command palette. All six `window.confirm` call sites are gone.
- **Long tasks are visible outside their panel**: translation and RAG indexing now report into the global task bar, so switching tabs no longer hides progress. Translation shows real percentages; RAG indexing only has status-level events, so it shows an indeterminate state rather than a fake percentage.
- **Keyboard focus is visible**: `:focus-visible` had no rule at all before, so tabbing through controls gave no feedback.
- **Dead code removed**: `LibrarySettingsDialog` (unreferenced; all 13 of its settings live in the unified settings panel) and `PdfAnnotationWorkspace` (806 lines superseded by the reader's inline annotation UI).

## New

- **Command palette** on `Ctrl/Cmd+K` — search and run navigation, tab, settings and theme actions. Shortcuts use a registry: `Ctrl/Cmd+W` closes the current tab, `Ctrl/Cmd+,` opens settings.
- `docs/ui-design-system.md` documents the token tables, component contracts, the sanctioned overlay/menu inventory, and the constraints new UI must respect.

## Verification

- Build passes, 901 tests pass (36 new).
- Verified on the real desktop build: library card layout at three container widths, graph label thinning and zoom-in, notes and settings changes, three migrated modals (Esc / focus trap / scroll lock), three context menus, translation progress in the task bar, and keyboard operation of the palette and focus ring.
- **Not individually re-verified**: the reader's four core flows (RAG Q&A, note saving, translation switching, sidebar drag-resize). The store refactor directly touches the state ownership of the first three; opening a paper with PDF, structured text and the assistant sidebar was confirmed working.
