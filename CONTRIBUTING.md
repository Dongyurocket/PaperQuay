# Contributing to PaperQuay

PaperQuay is a local-first desktop app. Small, focused contributions are easier to review and safer for users.

## Good First Contributions

- Fix UI text, layout, dark mode contrast, or English/Chinese localization.
- Improve the README, release notes, setup instructions, or troubleshooting notes.
- Add tests or small fixes around import, metadata parsing, Zotero compatibility, PDF reading, translation, or external-agent workflows.
- Report reproducible bugs with steps, screenshots, logs, and platform details.

## Platform Scope

Since 0.4.24, official releases, maintenance, and testing cover Windows x64 only. Other platforms can be built from source with the retained build targets, but they are not maintained or tested by the author. Historical release assets are kept.

## Development Setup

Requires Node.js 22.18 or newer (CI uses Node.js 24).

```bash
npm ci                 # install dependencies
npm run dev            # run the desktop app in development mode
npx tsc --noEmit       # type check
npm run build          # type check + Vite production build
npm test               # run tests/*.test.ts and tests/*.test.mjs
npm run electron:build -- --win --x64 --publish never   # build the Windows installer into release/
```

On Windows, if `npm run build` fails with esbuild `Access is denied` in the default temp directory, point `TEMP` and `TMP` to a directory inside the repository (for example `.tmp-build`) and run it again.

Self-builds for other platforms run on the matching host, for example `npm run electron:build -- --linux --x64 --publish never` or `npm run electron:build -- --mac --x64 --publish never`. You are responsible for building and testing these packages.

When testing against data, start the app with `--user-data-dir=<empty directory>` or use a copy of your library, never your real one.

## Pull Request Guidelines

- Keep each pull request to one problem or feature.
- Prefer clear module boundaries and readable code over large mixed refactors.
- Do not commit local data, API keys, PDFs, database files, parser output, build artifacts, or backups.
- Update documentation when behavior, settings, release workflow, or user-facing text changes.
- For UI changes, include screenshots or short recordings when possible. Capture them from the current build with temporary data, and remove personal paths, titles, and API keys.
- For bug fixes, describe the root cause and how you verified the fix.
- Pull requests run the Build workflow (`npm ci`, `npm run build`, `npm test` on Windows); make sure it passes.

## Licensing

By contributing to PaperQuay, you agree that your contributions are provided under the same license as this repository: `AGPL-3.0-only`.

PaperQuay trademarks and branding are not automatically licensed for unrestricted reuse. See [TRADEMARKS.md](./TRADEMARKS.md).
