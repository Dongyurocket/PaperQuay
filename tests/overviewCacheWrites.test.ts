import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverviewCacheWriter } from '../src/features/reader/overview/overviewCacheWrites.ts';

test('an obsolete legacy read cannot replace a newly generated cache', async () => {
  const write = createOverviewCacheWriter();
  let generation = 0;
  const readGeneration = generation;
  let disk = 'LEGACY';
  generation += 1;
  await write(async () => { disk = 'NEW'; });
  await write(async () => { disk = 'OLD'; }, () => generation === readGeneration);
  assert.equal(disk, 'NEW');
});

test('a migration already writing finishes before the newer generated save', async () => {
  const write = createOverviewCacheWriter();
  let releaseMigration!: () => void;
  const delayedWrite = new Promise<void>((resolve) => { releaseMigration = resolve; });
  let disk = '';
  const migration = write(async () => { await delayedWrite; disk = 'OLD'; });
  await Promise.resolve();
  const generated = write(async () => { disk = 'NEW'; });
  releaseMigration();
  await Promise.all([migration, generated]);
  assert.equal(disk, 'NEW');
});

test('failed migration does not block the next cache save', async () => {
  const write = createOverviewCacheWriter();
  const failed = write(async () => { throw new Error('Missing legacy directory'); });
  let saved = false;
  const generated = write(async () => { saved = true; });
  await assert.rejects(failed, /Missing legacy directory/);
  await generated;
  assert.equal(saved, true);
});
