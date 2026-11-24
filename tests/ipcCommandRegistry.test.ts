import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TYPED_IPC_COMMANDS as TS_TYPED_COMMANDS } from '../src/services/ipcCommands.ts';

const require = createRequire(import.meta.url);
const {
  COMMAND_SCHEMAS,
  TYPED_IPC_COMMANDS,
  assertSupportedSchema,
  validateIpcArgs,
  validateIpcResult,
  validateSchemaValue,
} = require('../electron/ipcCommandRegistry.cjs');
const { RENDERER_ALLOWED_COMMANDS } = require('../electron/ipcAllowlist.cjs');
const { createCommandInvoker } = require('../electron/backend.cjs');

function assertInvalidArgs(command: string, args: unknown, pattern: RegExp) {
  assert.throws(
    () => validateIpcArgs(command, args),
    (error: Error) => {
      assert.ok(error instanceof Error);
      assert.ok(
        error.message.startsWith('IPC_INVALID_ARGS:'),
        `expected IPC_INVALID_ARGS prefix, got: ${error.message}`,
      );
      assert.ok(error.message.includes(command), `expected command in message: ${error.message}`);
      assert.match(error.message, pattern);
      return true;
    },
  );
}

test('every typed IPC command is allowlisted and has an args schema', () => {
  assert.ok(TYPED_IPC_COMMANDS.length >= 15);
  assert.deepEqual(
    [...TYPED_IPC_COMMANDS].sort(),
    Object.keys(COMMAND_SCHEMAS).sort(),
    'TYPED_IPC_COMMANDS must match the schema registry',
  );
  assert.deepEqual(
    [...TS_TYPED_COMMANDS].sort(),
    [...TYPED_IPC_COMMANDS].sort(),
    'renderer-side typed command list must match the main-process registry',
  );

  for (const command of TYPED_IPC_COMMANDS) {
    assert.equal(
      RENDERER_ALLOWED_COMMANDS.has(command),
      true,
      `${command} is typed but missing from RENDERER_ALLOWED_COMMANDS`,
    );
    const schema = COMMAND_SCHEMAS[command];
    assert.equal(schema?.args?.type, 'object', `${command} must declare object args`);
    assertSupportedSchema(schema.args, `${command}.args`);
    if (schema.result) assertSupportedSchema(schema.result, `${command}.result`);
  }
});

test('valid renderer payloads pass args validation for the typed surface', () => {
  const validCases: Array<[string, Record<string, unknown>]> = [
    ['app_settings_get', {}],
    ['app_settings_get_secrets', {}],
    ['app_settings_patch', { patch: { uiLanguage: 'en' }, expectedRevision: 3 }],
    ['app_settings_patch', { patch: {}, zoteroLocalDataDir: 'C:\\Zotero' }],
    ['app_settings_patch_secrets', { patch: { zoteroApiKey: 'k' }, expectedRevision: 0 }],
    ['app_settings_migrate_legacy', { settings: null, secrets: null, noteCitationStyle: 'apa7', zoteroLocalDataDir: null }],
    ['library_update_settings', { settings: { storageDir: 'C:\\papers', importMode: 'keep' } }],
    ['library_import_pdfs', { request: { paths: ['C:\\a.pdf'], source: 'local', metadata: {} } }],
    ['library_update_paper', { request: { paperId: 'paper-1', title: 'T', expectedUpdatedAt: 12, tags: ['x'] } }],
    ['notes_update', { id: 'note-1', patch: { title: 'N' }, expectedUpdatedAt: 4 }],
    ['delete_text_file', { path: 'C:\\Users\\me\\AppData\\Roaming\\PaperQuay\\cache.json' }],
    ['backup_import_inspect', { packagePath: 'C:\\b.pqbackup', password: 'p' }],
    [
      'backup_import_stage',
      {
        packagePath: 'C:\\b.pqbackup',
        password: 'p',
        targets: { libraryStorageDir: 'C:\\papers', notesVaultDir: null },
        currentRendererState: { localStorage: { a: 'b' } },
      },
    ],
    [
      'rag_retrieve_document_chunks',
      {
        request: {
          documentKey: 'doc-1',
          sourceType: 'pdf-text',
          topK: 6,
          queryEmbedding: [0.1, 0.2],
          queryText: 'query',
          excludedDocumentKeys: [],
          includeDiagnostics: true,
        },
      },
    ],
    [
      'rag_index_document',
      {
        request: {
          documentKey: 'doc-1',
          sourceType: 'pdf-text',
          sourceSignature: 'sig',
          embeddingModelKey: 'model',
          totalChunkCount: 1,
          chunks: [{ chunkId: 'c1', chunkIndex: 0, pageIndex: 0, text: 'hello', embedding: [0.1] }],
        },
      },
    ],
    ['rag_embed_text', { request: { text: 'hello', embedding: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' } } }],
    ['zotero_list_local_library_items', { options: { collectionId: 'ABC' } }],
  ];

  for (const [command, args] of validCases) {
    assert.equal(validateIpcArgs(command, args), true, `${command} rejected a valid payload`);
  }

  // Untyped commands stay on the string allowlist only.
  assert.equal(validateIpcArgs('translate_cancel', { requestId: 'x' }), true);
  assert.equal(validateIpcArgs('not_a_command', { anything: true }), true);
});

test('invalid payloads are rejected with command and path in the message', () => {
  assertInvalidArgs('app_settings_patch', null, /args: expected object/);
  assertInvalidArgs('app_settings_patch', {}, /args\.patch: required/);
  assertInvalidArgs('app_settings_patch', { patch: [] }, /args\.patch: expected object, received array/);
  assertInvalidArgs('app_settings_patch', { patch: {}, expectedRevision: 1.5 }, /args\.expectedRevision: expected integer/);
  assertInvalidArgs('app_settings_patch', { patch: {}, expectedRevision: -1 }, /args\.expectedRevision: expected number >= 0/);
  assertInvalidArgs('app_settings_patch', { patch: {}, bogus: true }, /args\.bogus: unexpected property/);

  assertInvalidArgs('library_import_pdfs', { request: {} }, /args\.request\.paths: required/);
  assertInvalidArgs(
    'library_import_pdfs',
    { request: { paths: ['ok.pdf', 42] } },
    /args\.request\.paths\[1\]: expected string, received number/,
  );
  assertInvalidArgs('library_import_pdfs', { request: { paths: 'C:\\a.pdf' } }, /args\.request\.paths: expected array/);

  assertInvalidArgs('library_update_paper', { request: { title: 'no id' } }, /args\.request\.paperId: required/);
  assertInvalidArgs('notes_update', { id: 'n', patch: null }, /args\.patch: expected object, received null/);
  assertInvalidArgs('notes_update', { id: 7, patch: {} }, /args\.id: expected string/);
  assertInvalidArgs('delete_text_file', {}, /args\.path: required/);
  assertInvalidArgs('delete_text_file', { path: 42 }, /args\.path: expected string/);

  assertInvalidArgs('backup_import_inspect', { packagePath: 'C:\\b', password: 5 }, /args\.password: expected string/);
  assertInvalidArgs(
    'backup_import_stage',
    { packagePath: 'C:\\b', password: 'p', targets: { notesVaultDir: null } },
    /args\.targets\.libraryStorageDir: required/,
  );

  assertInvalidArgs('rag_embed_text', { request: { text: 'x' } }, /args\.request\.embedding: required/);
  assertInvalidArgs(
    'rag_retrieve_document_chunks',
    { request: { queryEmbedding: [0.1, 'x'] } },
    /args\.request\.queryEmbedding\[1\]: expected number/,
  );
  assertInvalidArgs(
    'rag_retrieve_document_chunks',
    { request: { topK: 0 } },
    /args\.request\.topK: expected number >= 1/,
  );
  assertInvalidArgs(
    'rag_retrieve_document_chunks',
    { request: { topK: 201 } },
    /args\.request\.topK: expected number <= 200/,
  );
  assertInvalidArgs(
    'library_import_pdfs',
    { request: { paths: [], source: 'dropbox' } },
    /args\.request\.source: expected one of/,
  );
  assertInvalidArgs('zotero_list_local_library_items', { options: [] }, /args\.options: expected object/);
});

test('schema documents reject unknown keywords with a clear error', () => {
  assert.throws(
    () => assertSupportedSchema({ type: 'string', pattern: '^a' }, 'demo.args'),
    /Unsupported IPC schema keyword "pattern" at demo\.args/,
  );
  assert.throws(
    () => assertSupportedSchema({ type: 'object', properties: { a: { type: 'date' } } }, 'demo.args'),
    /Unsupported IPC schema type "date" at demo\.args\.properties\.a/,
  );
  assert.throws(
    () => assertSupportedSchema({ type: 'object', additionalProperties: { type: 'string' } }, 'demo.args'),
    /additionalProperties must be a boolean/,
  );
  assert.doesNotThrow(() => assertSupportedSchema({ type: ['string', 'null'] }, 'demo.args'));
});

test('validator supports the documented JSON Schema subset', () => {
  assert.equal(validateSchemaValue(3, { type: 'integer', minimum: 1, maximum: 5 }, { path: 'demo' }), true);
  assert.equal(validateSchemaValue('apa7', { type: 'string', enum: ['apa7', 'ieee'] }, { path: 'demo' }), true);
  assert.equal(
    validateSchemaValue([1, 2], { type: 'array', minItems: 1, maxItems: 2, items: { type: 'number' } }, { path: 'demo' }),
    true,
  );
  assert.throws(
    () => validateSchemaValue([], { type: 'array', minItems: 1 }, { path: 'demo' }),
    /IPC_INVALID_VALUE: demo: expected at least 1 item\(s\)/,
  );
  assert.throws(
    () => validateSchemaValue([1, 2, 3], { type: 'array', maxItems: 2 }, { path: 'demo' }),
    /IPC_INVALID_VALUE: demo: expected at most 2 item\(s\)/,
  );
  assert.throws(
    () => validateSchemaValue('mla', { type: 'string', enum: ['apa7', 'ieee'] }, { path: 'demo' }),
    /IPC_INVALID_VALUE: demo: expected one of/,
  );
  assert.throws(
    () => validateSchemaValue(7, { type: 'integer', maximum: 5 }, { path: 'demo' }),
    /IPC_INVALID_VALUE: demo: expected number <= 5/,
  );
  assert.throws(
    () => validateSchemaValue(2.5, { type: 'integer' }, { path: 'demo' }),
    /IPC_INVALID_VALUE: demo: expected integer, received number/,
  );
});

test('result validation is opt-in and reports JSON-pointer-ish paths', () => {
  assert.equal(validateIpcResult('rag_embed_text', [0.1, 0.2]), true);
  assert.equal(validateIpcResult('app_settings_get', { revision: 1, settings: {} }), true);
  // Commands without a declared result schema are not validated.
  assert.equal(validateIpcResult('rag_index_document', undefined), true);

  assert.throws(
    () => validateIpcResult('rag_embed_text', [0.1, 'nope']),
    (error: Error) => {
      assert.ok(error.message.startsWith('IPC_INVALID_RESULT:'));
      assert.match(error.message, /rag_embed_text/);
      assert.match(error.message, /result\[1\]: expected number, received string/);
      return true;
    },
  );
  assert.throws(
    () => validateIpcResult('app_settings_patch', { revision: 1 }),
    /IPC_INVALID_RESULT: app_settings_patch: result\.ok: required/,
  );
});

test('createCommandInvoker validates args before the handler and gates result checks by env', async () => {
  const calls: Array<[string, unknown]> = [];
  const invoke = createCommandInvoker({
    app_settings_patch: async (args: unknown) => {
      calls.push(['app_settings_patch', args]);
      return { ok: true, revision: 1 };
    },
    rag_embed_text: async () => {
      calls.push(['rag_embed_text', null]);
      return ['not-a-number'];
    },
  });

  await assert.rejects(
    invoke('app_settings_patch', { patch: null }),
    /IPC_INVALID_ARGS: app_settings_patch: args\.patch: expected object/,
  );
  assert.deepEqual(calls, [], 'invalid args must never reach the handler');

  await assert.rejects(invoke('unknown_command', {}), /Unsupported Electron command: unknown_command/);

  const previous = process.env.PAPERQUAY_VALIDATE_IPC_RESULTS;
  try {
    delete process.env.PAPERQUAY_VALIDATE_IPC_RESULTS;
    assert.deepEqual(await invoke('app_settings_patch', { patch: { uiLanguage: 'en' } }), {
      ok: true,
      revision: 1,
    });
    assert.deepEqual(await invoke('rag_embed_text', { request: { text: 'x', embedding: {} } }), [
      'not-a-number',
    ]);

    process.env.PAPERQUAY_VALIDATE_IPC_RESULTS = '1';
    await assert.rejects(
      invoke('rag_embed_text', { request: { text: 'x', embedding: {} } }),
      /IPC_INVALID_RESULT: rag_embed_text: result\[0\]: expected number/,
    );
    assert.deepEqual(await invoke('app_settings_patch', { patch: {} }), { ok: true, revision: 1 });
  } finally {
    if (previous === undefined) delete process.env.PAPERQUAY_VALIDATE_IPC_RESULTS;
    else process.env.PAPERQUAY_VALIDATE_IPC_RESULTS = previous;
  }
});
