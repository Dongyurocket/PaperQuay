'use strict';

/**
 * 类型化 IPC 命令注册表（D1-14）。
 *
 * `paperquay:invoke` 仍是单一通道，命令名仍是字符串；这里为渲染层真正使用的
 * 命令补充逐命令的 args/result schema，在 backend.invoke 里调用 handler 之前
 * 校验。校验器刻意保持小而零依赖：只支持项目实际用到的 JSON Schema 子集，
 * 遇到未知关键字直接报错，避免 schema 写错后静默失效。
 *
 * 约定：
 *   - 未登记的命令不做参数校验（仍受 ipcAllowlist 字符串白名单约束）；
 *   - `undefined` 属性按缺失处理（structured clone 会保留值为 undefined 的键）；
 *   - 大对象（patch/request/options）保持 additionalProperties: true，
 *     只约束外层命令面，避免把现有合法调用挡在门外。
 */

const SUPPORTED_KEYWORDS = new Set([
  'type',
  'required',
  'properties',
  'additionalProperties',
  'enum',
  'minimum',
  'maximum',
  'items',
  'minItems',
  'maxItems',
  'description',
  'title',
]);

const SUPPORTED_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

function schemaFailure(message) {
  const error = new Error(message);
  error.code = 'IPC_SCHEMA_UNSUPPORTED';
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return valueType(value) === type;
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'number (non-finite)';
  return typeof value;
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function childPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * 校验 schema 本身只使用受支持的关键字与类型。未知关键字必须报错，
 * 否则拼错的 `requird`/`properties` 会让校验静默变成 no-op。
 */
function assertSupportedSchema(schema, path = 'schema') {
  if (!isPlainObject(schema)) {
    throw schemaFailure(`Unsupported IPC schema at ${path}: expected an object`);
  }

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw schemaFailure(`Unsupported IPC schema keyword "${keyword}" at ${path}`);
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0) {
      throw schemaFailure(`IPC schema type array must not be empty at ${path}`);
    }
    for (const type of types) {
      if (typeof type !== 'string' || !SUPPORTED_TYPES.has(type)) {
        throw schemaFailure(`Unsupported IPC schema type "${String(type)}" at ${path}`);
      }
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string')) {
      throw schemaFailure(`required must be an array of strings at ${path}`);
    }
  }

  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      throw schemaFailure(`properties must be an object at ${path}`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${path}.properties.${key}`);
    }
  }

  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    throw schemaFailure(`additionalProperties must be a boolean at ${path}`);
  }

  if (schema.items !== undefined) {
    assertSupportedSchema(schema.items, `${path}.items`);
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw schemaFailure(`enum must be an array at ${path}`);
  }

  for (const keyword of ['minimum', 'maximum']) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== 'number') {
      throw schemaFailure(`${keyword} must be a number at ${path}`);
    }
  }

  for (const keyword of ['minItems', 'maxItems']) {
    if (
      schema[keyword] !== undefined
      && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)
    ) {
      throw schemaFailure(`${keyword} must be a non-negative integer at ${path}`);
    }
  }

  return true;
}

function validateValue(value, schema, path, fail) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(value, type))) {
      fail(`${path}: expected ${types.join(' or ')}, received ${describeValue(value)}`);
      return;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => valuesEqual(candidate, value))) {
    fail(`${path}: expected one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`);
    return;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(`${path}: expected number >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(`${path}: expected number <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`${path}: expected at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(`${path}: expected at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, fail));
    }
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
        fail(`${path}.${key}: required`);
      }
    }

    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
        validateValue(value[key], child, childPath(path, key), fail);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (value[key] === undefined) continue;
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          fail(`${path}.${key}: unexpected property`);
        }
      }
    }
  }
}

function objectSchema(properties = {}, { required = [], additionalProperties = false } = {}) {
  return { type: 'object', properties, required, additionalProperties };
}

function stringArraySchema() {
  return { type: 'array', items: { type: 'string' } };
}

const optionalString = { type: ['string', 'null'] };

/**
 * 命令 -> { args, result? }。只登记已确认参数形状的命令；新增命令先登记
 * schema，再加入 ipcAllowlist。result 只在 PAPERQUAY_VALIDATE_IPC_RESULTS=1
 * 时校验，避免把历史上返回形状宽松的命令直接变成线上故障。
 */
const COMMAND_SCHEMAS = {
  app_settings_get: {
    args: objectSchema(),
    result: { type: 'object' },
  },
  app_settings_get_secrets: {
    args: objectSchema(),
    result: { type: 'object' },
  },
  app_settings_patch: {
    args: objectSchema(
      {
        patch: { type: 'object', description: '键值 patch，由设置契约校验具体键' },
        zoteroLocalDataDir: optionalString,
        expectedRevision: { type: 'integer', minimum: 0 },
      },
      { required: ['patch'] },
    ),
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        revision: { type: 'integer' },
        code: { type: 'string' },
      },
      { required: ['ok'], additionalProperties: true },
    ),
  },
  app_settings_patch_secrets: {
    args: objectSchema(
      {
        patch: { type: 'object' },
        expectedRevision: { type: 'integer', minimum: 0 },
      },
      { required: ['patch'] },
    ),
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        revision: { type: 'integer' },
        code: { type: 'string' },
      },
      { required: ['ok'], additionalProperties: true },
    ),
  },
  app_settings_migrate_legacy: {
    args: objectSchema({
      settings: { type: ['object', 'null'] },
      secrets: { type: ['object', 'null'] },
      noteCitationStyle: optionalString,
      zoteroLocalDataDir: optionalString,
    }),
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        revision: { type: 'integer' },
        code: { type: 'string' },
      },
      { required: ['ok'], additionalProperties: true },
    ),
  },
  library_update_settings: {
    args: objectSchema({ settings: { type: 'object' } }, { required: ['settings'] }),
    result: { type: 'object' },
  },
  library_import_pdfs: {
    args: objectSchema(
      {
        request: objectSchema(
          {
            paths: stringArraySchema(),
            targetCategoryId: optionalString,
            importMode: optionalString,
            source: { type: ['string', 'null'], enum: ['local', 'zotero', null] },
            metadata: { type: ['object', 'null'] },
          },
          { required: ['paths'], additionalProperties: true },
        ),
      },
      { required: ['request'] },
    ),
    result: { type: 'array', items: { type: 'object' } },
  },
  library_update_paper: {
    args: objectSchema(
      {
        request: objectSchema(
          {
            paperId: { type: 'string' },
            expectedUpdatedAt: { type: 'integer', minimum: 0 },
            title: optionalString,
            titleZh: optionalString,
            year: optionalString,
            publication: optionalString,
            doi: optionalString,
            url: optionalString,
            abstractText: optionalString,
            itemType: optionalString,
            publisher: optionalString,
            institution: optionalString,
            reportNumber: optionalString,
            volume: optionalString,
            issue: optionalString,
            pages: optionalString,
            isbn: optionalString,
            issn: optionalString,
            language: optionalString,
            citationKey: optionalString,
            userNote: optionalString,
            aiSummary: optionalString,
            citation: optionalString,
            keywords: { type: ['array', 'null'], items: { type: 'string' } },
            tags: { type: ['array', 'null'], items: { type: 'string' } },
            authors: { type: ['array', 'null'], items: { type: 'string' } },
            authorDetails: { type: ['array', 'null'], items: { type: 'object' } },
            isFavorite: { type: ['boolean', 'null'] },
          },
          { required: ['paperId'], additionalProperties: true },
        ),
      },
      { required: ['request'] },
    ),
    result: { type: 'object' },
  },
  notes_update: {
    args: objectSchema(
      {
        id: { type: 'string' },
        patch: { type: 'object' },
        expectedUpdatedAt: { type: 'integer', minimum: 0 },
      },
      { required: ['id', 'patch'] },
    ),
    result: { type: 'object' },
  },
  delete_text_file: {
    args: objectSchema(
      {
        path: { type: 'string' },
      },
      { required: ['path'] },
    ),
    result: { type: 'boolean' },
  },
  backup_import_inspect: {
    args: objectSchema(
      {
        packagePath: { type: 'string' },
        password: { type: 'string' },
      },
      { required: ['packagePath', 'password'] },
    ),
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        warnings: { type: 'array' },
      },
      { required: ['ok'], additionalProperties: true },
    ),
  },
  backup_import_stage: {
    args: objectSchema(
      {
        packagePath: { type: 'string' },
        password: { type: 'string' },
        targets: objectSchema(
          {
            libraryStorageDir: { type: 'string' },
            translatedPdfDir: optionalString,
            notesVaultDir: optionalString,
          },
          { required: ['libraryStorageDir'], additionalProperties: true },
        ),
        currentRendererState: { type: 'object' },
      },
      { required: ['packagePath', 'password', 'targets'] },
    ),
    result: objectSchema(
      {
        ok: { type: 'boolean' },
        restoreId: { type: 'string' },
        restartRequired: { type: 'boolean' },
      },
      { required: ['ok', 'restoreId'], additionalProperties: true },
    ),
  },
  rag_retrieve_document_chunks: {
    args: objectSchema(
      {
        request: objectSchema(
          {
            documentKey: { type: 'string' },
            documentKeys: stringArraySchema(),
            sourceType: {
              type: ['string', 'null'],
              enum: ['mineru-markdown', 'pdf-text', 'note', null],
            },
            embeddingModelKey: { type: 'string' },
            sourceSignature: { type: 'string' },
            excludedDocumentKeys: stringArraySchema(),
            queryEmbedding: { type: 'array', items: { type: 'number' } },
            queryText: { type: 'string' },
            topK: { type: 'integer', minimum: 1, maximum: 200 },
            includeDiagnostics: { type: 'boolean' },
            includeIndexCoverage: { type: 'boolean' },
          },
          { additionalProperties: true },
        ),
      },
      { required: ['request'] },
    ),
    result: { type: ['array', 'object'] },
  },
  rag_index_document: {
    args: objectSchema(
      {
        request: objectSchema(
          {
            documentKey: { type: 'string' },
            title: { type: 'string' },
            sourceType: {
              type: 'string',
              enum: ['mineru-markdown', 'pdf-text', 'note'],
            },
            sourceSignature: { type: 'string' },
            embeddingModelKey: { type: 'string' },
            totalChunkCount: { type: 'integer', minimum: 0 },
            generationId: { type: 'string' },
            chunks: {
              type: 'array',
              items: objectSchema(
                {
                  chunkId: { type: 'string' },
                  chunkIndex: { type: 'integer', minimum: 0 },
                  pageIndex: { type: ['integer', 'null'] },
                  text: { type: 'string' },
                  embedding: { type: 'array', items: { type: 'number' } },
                },
                { required: ['chunkId', 'text'], additionalProperties: true },
              ),
            },
          },
          {
            required: ['documentKey', 'sourceType', 'sourceSignature', 'embeddingModelKey', 'chunks'],
            additionalProperties: true,
          },
        ),
      },
      { required: ['request'] },
    ),
  },
  rag_embed_text: {
    args: objectSchema(
      {
        request: objectSchema(
          {
            text: { type: 'string' },
            embedding: { type: 'object' },
          },
          { required: ['text', 'embedding'], additionalProperties: true },
        ),
      },
      { required: ['request'] },
    ),
    result: { type: 'array', items: { type: 'number' } },
  },
  zotero_list_local_library_items: {
    args: objectSchema(
      {
        options: objectSchema(
          {
            dataDir: { type: 'string' },
            limit: { type: 'integer', minimum: 1 },
          },
          { additionalProperties: true },
        ),
      },
      { required: ['options'] },
    ),
    result: { type: 'array', items: { type: 'object' } },
  },
};

const TYPED_IPC_COMMANDS = Object.freeze(Object.keys(COMMAND_SCHEMAS));

function commandSchema(command) {
  return Object.prototype.hasOwnProperty.call(COMMAND_SCHEMAS, command)
    ? COMMAND_SCHEMAS[command]
    : null;
}

function validationError(prefix, command, message) {
  const error = new Error(`${prefix}: ${command}: ${message}`);
  error.code = prefix;
  return error;
}

/**
 * 直接校验任意值/ schema 组合（供注册表内部与单测使用）。
 * 失败抛 `<errorPrefix>: <path>: <reason>`。
 */
function validateSchemaValue(value, schema, { path = 'value', errorPrefix = 'IPC_INVALID_VALUE' } = {}) {
  assertSupportedSchema(schema, path);
  validateValue(value, schema, path, (message) => {
    const error = new Error(`${errorPrefix}: ${message}`);
    error.code = errorPrefix;
    throw error;
  });
  return true;
}

/**
 * 校验 args；未登记命令返回 true（白名单仍由 ipcAllowlist 负责）。
 * 失败抛 `IPC_INVALID_ARGS: <command>: <path>: <reason>`。
 */
function validateIpcArgs(command, args) {
  const entry = commandSchema(command);
  if (!entry) return true;

  assertSupportedSchema(entry.args, `${command}.args`);
  validateValue(args, entry.args, 'args', (message) => {
    throw validationError('IPC_INVALID_ARGS', command, message);
  });
  return true;
}

/**
 * 校验 result；只有登记了 result schema 的命令才校验。
 * 失败抛 `IPC_INVALID_RESULT: <command>: <path>: <reason>`。
 */
function validateIpcResult(command, result) {
  const entry = commandSchema(command);
  if (!entry?.result) return true;

  assertSupportedSchema(entry.result, `${command}.result`);
  validateValue(result, entry.result, 'result', (message) => {
    throw validationError('IPC_INVALID_RESULT', command, message);
  });
  return true;
}

module.exports = {
  COMMAND_SCHEMAS,
  TYPED_IPC_COMMANDS,
  assertSupportedSchema,
  validateIpcArgs,
  validateIpcResult,
  validateSchemaValue,
};
