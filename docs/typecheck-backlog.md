# checkJs 类型检查待清理清单

- 日期：2026-11-24
- 扫描命令（临时 tsconfig，扫描后已删除）：
  - `npx tsc --noEmit -p tsconfig.checkjs.full.tmp.json --pretty false`（`extends ./tsconfig.electron.json`，`checkJs: true`，`include: ["electron/**/*.cjs", "bin/**/*.cjs"]`）
  - `npx tsc --noEmit -p tsconfig.testsmjs.full.tmp.json --pretty false`（`checkJs: true`，`include: ["tests/**/*.mjs"]`）
- 当前纳入检查：`tsconfig.checkjs.json` 29 个文件；`tsconfig.tests.mjs.json` 22 个文件。
- 扫描范围：仅 `electron/**/*.cjs`、`bin/*.cjs` 与 `tests/**/*.mjs`；`src/shared/*.cjs`、`scripts/**/*.cjs` 不在这两份清单的扫描范围（前者由渲染层 tsconfig 使用，后者是本机脚本）。`tests` 的 250 个错误包含被测试静态 `require` 的 electron 文件，以及 2 个由 import 链带入的 `src/shared/appSettingsContract.cjs` 诊断，不全是测试文件自身。
- 判定口径：文件自身 0 诊断且其静态 `require` 依赖链也全部 0 诊断，才可加入 `include`；否则即使自身 0 诊断，也会因依赖文件报错而无法通过 `npm run typecheck`。
- 复扫时请用同样的临时 tsconfig，完成后删除，避免把临时配置带进提交。

## electron/bin（.cjs）

扫描范围共 87 个 `.cjs` 文件（含生成的 `electron/preload.bundle.cjs`，该产物不纳入 allowlist），其中 38 个文件有诊断，共 281 个错误；加上被连带检查的 `scripts/bundle-mcp.cjs`（3）与 `scripts/bundleMcpConfig.cjs`（8），整份程序合计 292 个错误。

| 文件 | 错误数 |
| --- | --- |
| `electron/appLifecycle.cjs` | 5 |
| `electron/appSecurity.cjs` | 1 |
| `electron/backend.cjs` | 2 |
| `electron/backend/agentRetiredCleanup.cjs` | 1 |
| `electron/backend/aiCommands.cjs` | 1 |
| `electron/backend/appSettings.cjs` | 3 |
| `electron/backend/appSettingsCommands.cjs` | 9 |
| `electron/backend/backupContainer.cjs` | 8 |
| `electron/backend/backupCrypto.cjs` | 1 |
| `electron/backend/backupDatabaseSnapshot.cjs` | 5 |
| `electron/backend/backupDatabaseWorker.cjs` | 1 |
| `electron/backend/backupExport.cjs` | 8 |
| `electron/backend/backupImport.cjs` | 12 |
| `electron/backend/backupSources.cjs` | 17 |
| `electron/backend/fileCommands.cjs` | 2 |
| `electron/backend/httpIO.cjs` | 10 |
| `electron/backend/knowledgeGraphCommands.cjs` | 8 |
| `electron/backend/libraryAttachments.cjs` | 1 |
| `electron/backend/libraryCommands.cjs` | 8 |
| `electron/backend/libraryDatabaseStore.cjs` | 10 |
| `electron/backend/libraryStore.cjs` | 2 |
| `electron/backend/mineruCacheCommands.cjs` | 2 |
| `electron/backend/noteCommands.cjs` | 7 |
| `electron/backend/noteStore.cjs` | 14 |
| `electron/backend/pdfMetadataCommands.cjs` | 2 |
| `electron/backend/ragWorkerHost.cjs` | 5 |
| `electron/backend/rag/retrieval.cjs` | 3 |
| `electron/backend/rag/schema.cjs` | 1 |
| `electron/backend/retainPdfIntegration.cjs` | 4 |
| `electron/backend/utils.cjs` | 10 |
| `electron/backend/zoteroApi.cjs` | 1 |
| `electron/backend/zoteroCommands.cjs` | 4 |
| `electron/dev.cjs` | 1 |
| `electron/ipcCommandRegistry.cjs` | 3 |
| `electron/main.cjs` | 4 |
| `electron/mcp/knowledgeMcpService.cjs` | 54 |
| `electron/shared/libraryDomain.cjs` | 37 |
| `electron/shared/ragSearch.cjs` | 14 |

以下文件自身 0 诊断，但依赖链中包含上表文件，暂不能加入 `include`（修复依赖后即可批量纳入）：

```text
bin/paperquay-mcp.cjs
electron/backend/backupCommands.cjs
electron/backend/integrationCommands.cjs
electron/backend/libraryCategories.cjs
electron/backend/libraryMetadata.cjs
electron/backend/libraryQuery.cjs
electron/backend/mineruCommands.cjs
electron/backend/noteEmbedding.cjs
electron/backend/noteHybridSearch.cjs
electron/backend/noteSearch.cjs
electron/backend/noteVault.cjs
electron/backend/pathPolicy.cjs
electron/backend/ragStore.cjs
electron/backend/ragWorker.cjs
electron/backend/rag/indexing.cjs
electron/backend/rag/runs.cjs
electron/backend/secretStorage.cjs
electron/backend/translatedPdfAttachments.cjs
electron/backend/zoteroLocal.cjs
electron/build.cjs
electron/localPdfProtocol.cjs
```

## tests（.mjs）

扫描范围共 54 个 `tests/**/*.mjs` 文件，其中 19 个文件有诊断，共 52 个错误（整份程序含被 import 的 electron 文件与 `src/shared/appSettingsContract.cjs`，合计 250 个错误：tests 自身 52 + electron 196 + src/shared 2）。

| 文件 | 错误数 |
| --- | --- |
| `tests/afterPackIntegrity.test.mjs` | 5 |
| `tests/appLifecycle.test.mjs` | 7 |
| `tests/appSecurity.test.mjs` | 7 |
| `tests/attachmentAvailabilityCache.test.mjs` | 1 |
| `tests/electronPreloadIntegration.test.mjs` | 1 |
| `tests/graphSimilarityScale.test.mjs` | 1 |
| `tests/knowledgeGraphCommands.test.mjs` | 3 |
| `tests/libraryBatchCommands.test.mjs` | 2 |
| `tests/libraryPaperPaging.test.mjs` | 2 |
| `tests/librarySettingsUpsert.test.mjs` | 1 |
| `tests/noteEditorConflict.test.mjs` | 2 |
| `tests/noteStoreSelection.test.mjs` | 1 |
| `tests/notesSidebarSearch.test.mjs` | 1 |
| `tests/pdfAssetGovernance.test.mjs` | 5 |
| `tests/readerQaBridge.test.mjs` | 3 |
| `tests/retainPdfIntegrationFlow.test.mjs` | 6 |
| `tests/retainPdfRecovery.test.mjs` | 1 |
| `tests/translationBatch.test.mjs` | 1 |
| `tests/vaultAutosyncReactivity.test.mjs` | 2 |
| `tests/graphGeometry.test.mjs` | 3 |
| `tests/graphSnapshotCache.test.mjs` | 2 |

以下测试文件自身 0 诊断，但依赖链中包含未清零文件，暂缓纳入：

```text
tests/backendModuleStructure.test.mjs
tests/graphSnapshotScale.test.mjs
tests/ipcSecurity.test.mjs
tests/knowledgeMcpRagCleanup.test.mjs
tests/libraryAttachmentAvailability.test.mjs
tests/libraryCommands.test.mjs
tests/libraryReadingImport.test.mjs
tests/libraryWriteTargeting.test.mjs
tests/mcpClientLaunch.test.mjs
tests/mineruCacheSharing.test.mjs
tests/noteRetrievalBenchmark.test.mjs
tests/pathPolicyAuthorization.test.mjs
tests/retainPdfIntegration.test.mjs
tests/secretStorage.test.mjs
```

## 分批建议

1. 先修错误数少的文件（1-4 个），修完从本清单移除并加入 `include`；`tests/lintConfig.test.mjs`、`tests/checkjsAllowlist.test.mjs` 会阻止名单漂移。
2. 大文件（`knowledgeMcpService.cjs` 54、`libraryDomain.cjs` 37、`backupSources.cjs` 17）单独成批。
3. 每次只把「自身 0 诊断 + 依赖链 0 诊断」的文件移入 `include`，保持 `npm run typecheck` 全绿。
