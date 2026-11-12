# Literature details tabs: first integration increment

## Scope

Started W-P5 by reorganizing the existing literature detail sidebar into four real tabs: Details, Processing & Files, AI Overview, and Reading. Existing controls remain connected to their existing handlers. The selected paper summary and actions stay visible above the tabs; the duplicate “Paper Details / Selected Paper” heading was removed. Selecting a different paper resets the active tab to Details, and a running processing task adds a persistent status marker to the Processing tab. The Details view exposes DOI, URL, abstract, and citation without entering edit mode. The empty AI Overview view offers its existing generation action when the PDF and handler are available.

The overview's internal section navigation remains separate from the four detail tabs. Reading history continues to show the most recently updated valid heatmap, with that scope stated in the UI. This increment does not claim the wider P5 integration is complete.

## Validation

| Check | Result |
| --- | --- |
| `npm run build` with `TEMP` and `TMP` under `.codex-tmp/p5-build-temp` | Passed; TypeScript and Vite production build completed, 2617 modules transformed. Existing large-chunk and ineffective dynamic-import warnings remain. |
| `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` with isolated TEMP | Passed; 992 tests, 0 failures. |
| Final `npm run build` after adding the empty-overview action and read-only metadata values | Passed; TypeScript and Vite production build completed, 2617 modules transformed. |
| `git diff --check` | Passed. |
| `node_modules/.bin/electron --version` | Failed with Windows exit status `-2147483645`; no desktop window was available. |
| Windows desktop interaction at 320/420/760px; keyboard tab navigation; task badge during live processing | Pending. No desktop evidence is claimed. |

## Remaining W-P5 work

Integrate and verify the list toolbar, filter panel/condition summary, and reader header container response. Complete narrow-pane, keyboard, paper-switch, language-update, and active-reader regression checks before closing P5.
