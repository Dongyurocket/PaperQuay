import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const lineCount = (relativePath) => read(relativePath).split('\n').length - 1;

const RAG_LAYER_FILES = [
  'electron/backend/rag/schema.cjs',
  'electron/backend/rag/indexing.cjs',
  'electron/backend/rag/retrieval.cjs',
  'electron/backend/rag/runs.cjs',
];

const LIBRARY_LAYER_FILES = [
  'electron/backend/libraryMetadata.cjs',
  'electron/backend/libraryAttachments.cjs',
  'electron/backend/libraryCategories.cjs',
];

const LIBRARY_COMMAND_NAMES = [
  'library_init',
  'library_get_settings',
  'library_update_settings',
  'library_list_categories',
  'library_list_citation_keys',
  'library_list_tags',
  'library_create_category',
  'library_update_category',
  'library_move_category',
  'library_delete_category',
  'library_list_papers',
  'library_query_papers',
  'library_get_paper',
  'library_get_paper_summary',
  'library_batch_update_papers',
  'library_batch_delete_papers',
  'library_list_paper_ids',
  'library_count_papers',
  'library_inspect_pdf_assets',
  'library_plan_pdf_asset_names',
  'library_reorder_papers',
  'library_import_pdfs',
  'library_assign_paper_category',
  'library_set_paper_categories',
  'library_record_reading',
  'library_update_paper',
  'library_delete_paper',
  'library_relocate_attachment',
  'library_get_paper_references',
  'library_add_attachment',
  'library_update_translated_pdf_languages',
  'library_remove_attachment',
  'library_fetch_paper_references',
  'library_fetch_all_references',
  'lookup_literature_metadata',
];

test('ragStore is a thin facade over schema/indexing/retrieval/runs layers', () => {
  for (const relativePath of RAG_LAYER_FILES) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
  }

  const facade = read('electron/backend/ragStore.cjs');
  assert.ok(lineCount('electron/backend/ragStore.cjs') <= 400, 'ragStore.cjs must stay a thin facade (<= 400 lines)');

  for (const layer of ['schema', 'indexing', 'retrieval', 'runs']) {
    assert.match(
      facade,
      new RegExp(`require\\('\\./rag/${layer}\\.cjs'\\)`),
      `ragStore.cjs must require ./rag/${layer}.cjs`,
    );
  }

  const ragStoreModule = require('../electron/backend/ragStore.cjs');
  assert.deepEqual(Object.keys(ragStoreModule).sort(), ['buildFtsMatchQuery', 'createRagStore', 'rrfFuse']);
  assert.equal(typeof ragStoreModule.createRagStore, 'function');
});

test('libraryCommands composes metadata/attachments/categories modules', () => {
  for (const relativePath of LIBRARY_LAYER_FILES) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must exist`);
  }

  const composition = read('electron/backend/libraryCommands.cjs');
  assert.ok(lineCount('electron/backend/libraryCommands.cjs') <= 800, 'libraryCommands.cjs must keep only composition and shared commands (<= 800 lines)');

  for (const moduleName of ['libraryMetadata', 'libraryAttachments', 'libraryCategories']) {
    assert.match(
      composition,
      new RegExp(`require\\('\\./${moduleName}\\.cjs'\\)`),
      `libraryCommands.cjs must require ./${moduleName}.cjs`,
    );
  }

  const { createLibraryCommands } = require('../electron/backend/libraryCommands.cjs');
  assert.equal(typeof createLibraryCommands, 'function');

  const commands = createLibraryCommands({ appPaths: {}, store: {} });
  assert.deepEqual(Object.keys(commands).sort(), [...LIBRARY_COMMAND_NAMES].sort());

  for (const commandName of [
    'library_init',
    'library_import_pdfs',
    'library_fetch_all_references',
    'library_fetch_paper_references',
    'lookup_literature_metadata',
    'library_add_attachment',
    'library_remove_attachment',
    'library_update_translated_pdf_languages',
    'library_create_category',
    'library_update_category',
    'library_move_category',
    'library_delete_category',
    'library_assign_paper_category',
    'library_set_paper_categories',
  ]) {
    assert.equal(typeof commands[commandName], 'function', `${commandName} must still be returned`);
  }
});
