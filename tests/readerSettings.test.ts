import assert from "node:assert/strict";
import test from "node:test";

import { build } from "esbuild";

// F5：不在磁盘上落产物。esbuild 写 %TEMP% 会被本机安全软件锁住
// （`Access is denied`），改为 `write: false` 后用 data: URL 直接 import。
async function loadReaderShared() {
  const bundle = await build({
    bundle: true,
    entryPoints: ["src/features/reader/readerShared.ts"],
    format: "esm",
    platform: "node",
    sourcemap: false,
    write: false,
    logLevel: "silent",
  });

  const code = bundle.outputFiles[0].text;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
  return module as typeof import("../src/features/reader/readerShared.ts");
}

test("normalizeReaderSettings defaults review writing model preset", async () => {
  const { DEFAULT_SETTINGS, normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings();

  assert.equal(settings.reviewModelPresetId, DEFAULT_SETTINGS.reviewModelPresetId);
  assert.equal(settings.noteCitationStyle, 'gbt7714');
  assert.equal(settings.notesVaultAutoSyncEnabled, false);
  assert.equal(settings.notesVaultAutoSyncIntervalMinutes, 30);
});

test("normalizeReaderSettings constrains note settings", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();

  assert.equal(normalizeReaderSettings({
    noteCitationStyle: 'ieee',
    notesVaultAutoSyncEnabled: true,
    notesVaultAutoSyncIntervalMinutes: 90,
  }).noteCitationStyle, 'ieee');
  assert.equal(normalizeReaderSettings({
    noteCitationStyle: 'unknown' as never,
    notesVaultAutoSyncIntervalMinutes: 10,
  }).noteCitationStyle, 'gbt7714');
  assert.equal(normalizeReaderSettings({ notesVaultAutoSyncIntervalMinutes: 10 }).notesVaultAutoSyncIntervalMinutes, 15);
  assert.equal(normalizeReaderSettings({ notesVaultAutoSyncIntervalMinutes: 90 }).notesVaultAutoSyncIntervalMinutes, 60);
});

test("RAG automation defaults stay conservative and clamp their ranges", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();

  const defaults = normalizeReaderSettings();
  assert.equal(defaults.ragAutoIndexAfterParse, true);
  assert.equal(defaults.ragAutoRetryFailed, false);
  assert.equal(defaults.ragAutoRetryMaxAttempts, 2);
  assert.equal(defaults.ragAutoRetryIntervalMinutes, 30);

  assert.equal(normalizeReaderSettings({ ragAutoIndexAfterParse: false }).ragAutoIndexAfterParse, false);
  assert.equal(normalizeReaderSettings({ ragAutoRetryMaxAttempts: -1 }).ragAutoRetryMaxAttempts, 0);
  assert.equal(normalizeReaderSettings({ ragAutoRetryMaxAttempts: 99 }).ragAutoRetryMaxAttempts, 5);
  assert.equal(normalizeReaderSettings({ ragAutoRetryIntervalMinutes: 1 }).ragAutoRetryIntervalMinutes, 5);
  assert.equal(normalizeReaderSettings({ ragAutoRetryIntervalMinutes: 999 }).ragAutoRetryIntervalMinutes, 240);
});

test("normalizeReaderSettings migrates review writing model preset from overview preset", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings({
    reviewModelPresetId: "",
    summaryModelPresetId: "summary-model",
  });

  assert.equal(settings.reviewModelPresetId, "summary-model");
});

test("normalizeReaderSettings drops the retired agent preset instead of migrating it", async () => {
  const { normalizeReaderSettings } = await loadReaderShared();
  const settings = normalizeReaderSettings({
    reviewModelPresetId: "",
    summaryModelPresetId: "",
    agentModelPresetId: "agent-model",
    modelRuntimeConfigs: { agent: { temperature: 0.3 }, summary: { temperature: 0.2 } },
  } as any);

  assert.equal(settings.reviewModelPresetId, "default");
  assert.equal("agentModelPresetId" in settings, false);
  assert.equal("agent" in settings.modelRuntimeConfigs, false);
  assert.equal(settings.modelRuntimeConfigs.summary?.temperature, 0.2);
});

test("review writing runtime config is normalized independently", async () => {
  const {
    getModelRuntimeConfig,
    normalizeModelRuntimeConfigs,
    normalizeReaderSettings,
  } = await loadReaderShared();
  const modelRuntimeConfigs = normalizeModelRuntimeConfigs({
    summary: { temperature: 0.2, reasoningEffort: "low" },
    review: { temperature: 0.6, reasoningEffort: "high" },
  });
  const settings = normalizeReaderSettings({ modelRuntimeConfigs });

  assert.deepEqual(getModelRuntimeConfig(settings, "review"), {
    temperature: 0.6,
    reasoningEffort: "high",
  });
});

test("Agent model preset capability flags default conservatively", async () => {
  const { createQaPreset } = await loadReaderShared();

  assert.equal(createQaPreset({ model: "vision-test" }).supportsVision, false);
  assert.equal(createQaPreset({ model: "vision-test", supportsVision: true, contextWindow: 256000 }).supportsVision, true);
  assert.equal(createQaPreset({ model: "vision-test", contextWindow: 256000 }).contextWindow, 256000);
});
