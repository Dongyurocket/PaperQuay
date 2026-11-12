const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, sqlStringLiteral, withTransaction } = require('./nodeSqlite.cjs');

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }

function createKnowledgeStore(appPaths) {
  fs.mkdirSync(path.dirname(appPaths.knowledgeDatabasePath), { recursive: true });
  const db = new DatabaseSync(appPaths.knowledgeDatabasePath, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_documents (
      source_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_version TEXT NOT NULL,
      current_generation TEXT, status TEXT NOT NULL DEFAULT 'active', updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_generations (
      generation_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source_documents(source_id) ON DELETE CASCADE,
      source_version TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
      artifact_path TEXT, artifact_manifest TEXT
    );
    CREATE TABLE IF NOT EXISTS document_units (
      unit_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES document_generations(generation_id) ON DELETE CASCADE,
      parent_unit_id TEXT, unit_kind TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT, physical_start INTEGER,
      physical_end INTEGER, printed_start TEXT, printed_end TEXT, unit_revision TEXT, content_hash TEXT, content TEXT
    );
    CREATE INDEX IF NOT EXISTS document_units_generation_order ON document_units(generation_id, ordinal);
    CREATE TABLE IF NOT EXISTS document_unit_revisions (
      generation_id TEXT NOT NULL REFERENCES document_generations(generation_id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL, unit_revision TEXT NOT NULL, parent_unit_id TEXT, unit_kind TEXT NOT NULL,
      ordinal INTEGER NOT NULL, title TEXT, physical_start INTEGER NOT NULL, physical_end INTEGER NOT NULL,
      printed_start TEXT, printed_end TEXT, content_hash TEXT, content TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(generation_id,unit_id,unit_revision)
    );
    CREATE INDEX IF NOT EXISTS document_unit_revisions_order ON document_unit_revisions(generation_id,unit_id,created_at);
    CREATE TABLE IF NOT EXISTS document_pages (
      generation_id TEXT NOT NULL REFERENCES document_generations(generation_id) ON DELETE CASCADE,
      physical_page INTEGER NOT NULL, printed_page TEXT, unit_id TEXT, mapping_revision TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(generation_id, physical_page)
    );
    CREATE TABLE IF NOT EXISTS document_page_revisions (
      generation_id TEXT NOT NULL REFERENCES document_generations(generation_id) ON DELETE CASCADE,
      physical_page INTEGER NOT NULL, mapping_revision TEXT NOT NULL, printed_page TEXT, unit_id TEXT,
      created_at INTEGER NOT NULL, PRIMARY KEY(generation_id,physical_page,mapping_revision)
    );
    CREATE INDEX IF NOT EXISTS document_page_revisions_order ON document_page_revisions(generation_id,physical_page,created_at);
    CREATE TABLE IF NOT EXISTS parse_partitions (
      partition_id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES document_generations(generation_id) ON DELETE CASCADE,
      partition_index INTEGER NOT NULL, physical_start INTEGER NOT NULL, physical_end INTEGER NOT NULL,
      input_hash TEXT NOT NULL, status TEXT NOT NULL, staged_path TEXT, staged_manifest TEXT, remote_job_id TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kg_custom_relations (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL,
      label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', confidence REAL, weight REAL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kg_source_versions (
      source_version_id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
      source_version TEXT NOT NULL, source_type TEXT NOT NULL, role_snapshot TEXT NOT NULL DEFAULT '{}',
      content_signature TEXT NOT NULL, parse_generation TEXT, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(source_id,source_version,source_type,content_signature)
    );
    CREATE INDEX IF NOT EXISTS kg_source_versions_source_state ON kg_source_versions(source_id,state,created_at);
    CREATE TABLE IF NOT EXISTS kg_evidence_spans (
      evidence_id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL REFERENCES kg_source_versions(source_version_id) ON DELETE CASCADE,
      unit_id TEXT, unit_revision TEXT, page_index INTEGER NOT NULL, printed_page TEXT, block_id TEXT, chunk_id TEXT,
      section_path TEXT NOT NULL DEFAULT '[]', start_offset INTEGER, end_offset INTEGER,
      quote TEXT NOT NULL, quote_hash TEXT NOT NULL, locator_status TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS kg_evidence_source_version_page ON kg_evidence_spans(source_version_id,page_index);
    CREATE INDEX IF NOT EXISTS kg_evidence_block ON kg_evidence_spans(block_id);
    CREATE TABLE IF NOT EXISTS kg_review_events (
      review_event_id TEXT PRIMARY KEY, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
      object_revision TEXT NOT NULL, decision TEXT NOT NULL, reviewer TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS kg_review_object_time ON kg_review_events(object_type,object_id,created_at);
  `);
  const generationColumns = new Set(db.prepare('PRAGMA table_info(document_generations)').all().map((row) => row.name));
  if (!generationColumns.has('artifact_path')) db.exec('ALTER TABLE document_generations ADD COLUMN artifact_path TEXT');
  if (!generationColumns.has('artifact_manifest')) db.exec('ALTER TABLE document_generations ADD COLUMN artifact_manifest TEXT');
  const unitColumns = new Set(db.prepare('PRAGMA table_info(document_units)').all().map((row) => row.name));
  if (!unitColumns.has('unit_revision')) db.exec("ALTER TABLE document_units ADD COLUMN unit_revision TEXT NOT NULL DEFAULT ''");
  const pageColumns = new Set(db.prepare('PRAGMA table_info(document_pages)').all().map((row) => row.name));
  if (!pageColumns.has('mapping_revision')) db.exec("ALTER TABLE document_pages ADD COLUMN mapping_revision TEXT NOT NULL DEFAULT ''");
  const partitionColumns = new Set(db.prepare('PRAGMA table_info(parse_partitions)').all().map((row) => row.name));
  if (!partitionColumns.has('remote_job_id')) db.exec('ALTER TABLE parse_partitions ADD COLUMN remote_job_id TEXT');
  if (!partitionColumns.has('staged_manifest')) db.exec('ALTER TABLE parse_partitions ADD COLUMN staged_manifest TEXT');
  db.exec("INSERT INTO knowledge_meta(key,value) VALUES('schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.exec('PRAGMA user_version = 2');

  const insertRelation = db.prepare(`INSERT INTO kg_custom_relations
    (id,source_id,target_id,relation_type,label,description,confidence,weight,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,
    target_id=excluded.target_id,relation_type=excluded.relation_type,label=excluded.label,
    description=excluded.description,confidence=excluded.confidence,weight=excluded.weight,updated_at=excluded.updated_at`);
  function writeRelation(relation) {
    insertRelation.run(relation.id, relation.source, relation.target, relation.type, relation.label,
      relation.description || '', relation.confidence ?? null, relation.weight ?? null,
      relation.createdAt, relation.updatedAt);
  }
  const evidenceHash = (quote) => crypto.createHash('sha256').update(quote, 'utf8').digest('hex');
  function registerSourceVersion(input) {
    const sourceId = clean(input?.sourceId);
    const sourceVersion = clean(input?.sourceVersion);
    const sourceType = clean(input?.sourceType);
    const contentSignature = clean(input?.contentSignature);
    if (!sourceId || !sourceVersion || !sourceType || !contentSignature) throw new TypeError('A knowledge source version requires source identity, version, type, and content signature.');
    const roleSnapshot = input?.roleSnapshot && typeof input.roleSnapshot === 'object' && !Array.isArray(input.roleSnapshot)
      ? input.roleSnapshot : {};
    const serializedRole = JSON.stringify(roleSnapshot);
    return withTransaction(db, () => {
      const source = db.prepare('SELECT source_version AS sourceVersion,status FROM source_documents WHERE source_id=?').get(sourceId);
      if (!source || source.sourceVersion !== sourceVersion || source.status !== 'active') return null;
      db.prepare("UPDATE kg_source_versions SET state='stale' WHERE source_id=? AND state='current' AND source_version<>?").run(sourceId, sourceVersion);
      const existing = db.prepare(`SELECT source_version_id AS sourceVersionId FROM kg_source_versions
        WHERE source_id=? AND source_version=? AND source_type=? AND content_signature=?`).get(sourceId, sourceVersion, sourceType, contentSignature);
      if (existing) {
        db.prepare(`UPDATE kg_source_versions SET role_snapshot=?,parse_generation=?,state='current' WHERE source_version_id=?`)
          .run(serializedRole, clean(input.parseGeneration) || null, existing.sourceVersionId);
        return { sourceVersionId: existing.sourceVersionId, sourceId, sourceVersion, sourceType, contentSignature, state: 'current' };
      }
      const sourceVersionId = clean(input.sourceVersionId) || crypto.randomUUID();
      db.prepare(`INSERT INTO kg_source_versions(source_version_id,source_id,source_version,source_type,role_snapshot,
        content_signature,parse_generation,state,created_at) VALUES(?,?,?,?,?,?,?,'current',?)`)
        .run(sourceVersionId, sourceId, sourceVersion, sourceType, serializedRole, contentSignature,
          clean(input.parseGeneration) || null, Date.now());
      return { sourceVersionId, sourceId, sourceVersion, sourceType, contentSignature, state: 'current' };
    });
  }
  function createEvidenceSpan(input) {
    const sourceVersionId = clean(input?.sourceVersionId);
    const quote = typeof input?.quote === 'string' ? input.quote : '';
    const evidenceText = typeof input?.evidenceText === 'string' ? input.evidenceText : '';
    const pageIndex = Number(input?.pageIndex);
    const startOffset = input?.startOffset == null ? null : Number(input.startOffset);
    const endOffset = input?.endOffset == null ? null : Number(input.endOffset);
    if (!sourceVersionId || !quote.trim() || !evidenceText || !Number.isSafeInteger(pageIndex) || pageIndex < 0 ||
      (startOffset != null && (!Number.isSafeInteger(startOffset) || startOffset < 0)) ||
      (endOffset != null && (!Number.isSafeInteger(endOffset) || endOffset < 0 || startOffset != null && endOffset < startOffset))) {
      throw new TypeError('Evidence requires a quote, its source block text, zero-based page, and valid optional offsets.');
    }
    const verifiedStart = startOffset ?? evidenceText.indexOf(quote);
    const verifiedEnd = endOffset ?? verifiedStart + quote.length;
    if (verifiedStart < 0 || verifiedEnd - verifiedStart !== quote.length || evidenceText.slice(verifiedStart, verifiedEnd) !== quote) {
      throw new TypeError('The evidence quote and offsets must match the supplied source text exactly.');
    }
    const source = db.prepare(`SELECT v.source_id AS sourceId,v.source_version AS sourceVersion,v.state,
      s.source_version AS currentVersion,s.status AS sourceStatus FROM kg_source_versions v
      JOIN source_documents s USING(source_id) WHERE v.source_version_id=?`).get(sourceVersionId);
    if (!source || source.state !== 'current' || source.sourceStatus !== 'active' || source.sourceVersion !== source.currentVersion) return null;
    const quoteHash = evidenceHash(quote);
    const locationIdentity = JSON.stringify([sourceVersionId, clean(input.unitId), input.unitRevision ?? '', pageIndex,
      clean(input.blockId), clean(input.chunkId), startOffset, endOffset, quoteHash]);
    const evidenceId = clean(input.evidenceId) || crypto.createHash('sha256').update(locationIdentity).digest('hex');
    const sectionPath = Array.isArray(input.sectionPath) ? input.sectionPath.filter((item) => typeof item === 'string') : [];
    withTransaction(db, () => {
      const current = db.prepare(`SELECT v.state,v.source_version AS sourceVersion,s.source_version AS currentVersion,s.status AS sourceStatus
        FROM kg_source_versions v JOIN source_documents s USING(source_id) WHERE v.source_version_id=?`).get(sourceVersionId);
      if (!current || current.state !== 'current' || current.sourceStatus !== 'active' || current.sourceVersion !== current.currentVersion) {
        throw new Error('The evidence source version changed before the span could be stored.');
      }
      db.prepare(`INSERT OR IGNORE INTO kg_evidence_spans(evidence_id,source_version_id,unit_id,unit_revision,page_index,
        printed_page,block_id,chunk_id,section_path,start_offset,end_offset,quote,quote_hash,locator_status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evidenceId, sourceVersionId, clean(input.unitId) || null,
        clean(input.unitRevision) || null, pageIndex, clean(input.printedPage) || null, clean(input.blockId) || null,
        clean(input.chunkId) || null, JSON.stringify(sectionPath), startOffset, endOffset, quote, quoteHash,
        ['exact','page-only','missing','needs-verification'].includes(input.locatorStatus) ? input.locatorStatus : 'needs-verification', Date.now());
    });
    return getEvidenceSpan(evidenceId);
  }
  function getEvidenceSpan(evidenceId) {
    const row = db.prepare(`SELECT e.evidence_id AS evidenceId,e.source_version_id AS sourceVersionId,
      v.source_id AS sourceId,v.source_version AS sourceVersion,v.source_type AS sourceType,v.parse_generation AS parseGeneration,v.state AS sourceState,
      s.source_version AS currentVersion,s.status AS documentStatus,e.unit_id AS unitId,e.unit_revision AS unitRevision,
      e.page_index AS pageIndex,e.printed_page AS printedPage,e.block_id AS blockId,e.chunk_id AS chunkId,
      e.section_path AS sectionPathJson,e.start_offset AS startOffset,e.end_offset AS endOffset,e.quote,e.quote_hash AS quoteHash,
      e.locator_status AS locatorStatus,e.created_at AS createdAt FROM kg_evidence_spans e
      JOIN kg_source_versions v USING(source_version_id) LEFT JOIN source_documents s USING(source_id) WHERE e.evidence_id=?`).get(clean(evidenceId));
    if (!row) return null;
    let sectionPath = [];
    try { sectionPath = JSON.parse(row.sectionPathJson); } catch {}
    const { sectionPathJson, currentVersion, documentStatus, sourceState, ...evidence } = row;
    return { ...evidence, sectionPath, sourceState: !documentStatus ? 'missing' : documentStatus !== 'active' ? 'excluded' : sourceState,
      isCurrent: documentStatus === 'active' && sourceState === 'current' && evidence.sourceVersion === currentVersion,
      quoteIntegrity: evidenceHash(row.quote) === row.quoteHash };
  }
  function recordReviewEvent(input) {
    const objectType = clean(input?.objectType);
    const objectId = clean(input?.objectId);
    const objectRevision = clean(input?.objectRevision);
    const decision = clean(input?.decision);
    const reviewer = clean(input?.reviewer);
    if (!objectType || !objectId || !objectRevision || !reviewer || !['accepted','rejected','needs_review','superseded'].includes(decision)) {
      throw new TypeError('A review event requires object identity, revision, reviewer, and a valid decision.');
    }
    const reviewEventId = clean(input.reviewEventId) || crypto.randomUUID();
    db.prepare(`INSERT INTO kg_review_events(review_event_id,object_type,object_id,object_revision,decision,reviewer,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(reviewEventId, objectType, objectId, objectRevision, decision, reviewer,
      clean(input.reason), Date.now());
    return { reviewEventId, objectType, objectId, objectRevision, decision, reviewer, reason: clean(input.reason) };
  }
  function beginGeneration({ sourceId, sourceKind = 'document', sourceVersion, generationId = crypto.randomUUID(), partitions }) {
    const normalizedSourceId = clean(sourceId);
    const normalizedVersion = clean(sourceVersion);
    if (!normalizedSourceId || !normalizedVersion || !Array.isArray(partitions) || partitions.length === 0) {
      throw new TypeError('A generation requires a source identity, source version, and at least one partition.');
    }
    const ordered = partitions.slice().sort((a, b) => a.index - b.index);
    let expectedStart = 1;
    for (let index = 0; index < ordered.length; index += 1) {
      const part = ordered[index];
      if (part.index !== index || part.startPage !== expectedStart || !Number.isSafeInteger(part.endPage) || part.endPage < part.startPage || !clean(part.inputHash)) {
        throw new TypeError('Generation partitions must form an ordered, contiguous page range with input hashes.');
      }
      expectedStart = part.endPage + 1;
    }
    withTransaction(db, () => {
      const existing = db.prepare('SELECT source_id AS sourceId,source_version AS sourceVersion,status FROM document_generations WHERE generation_id=?').get(generationId);
      if (existing) {
        if (existing.sourceId !== normalizedSourceId || existing.sourceVersion !== normalizedVersion) throw new Error('Generation identity conflicts with an existing generation.');
        return;
      }
      const timestamp = Date.now();
      db.prepare(`INSERT INTO source_documents(source_id,source_kind,source_version,current_generation,status,updated_at)
        VALUES(?,?,?,NULL,'active',?) ON CONFLICT(source_id) DO UPDATE SET source_kind=excluded.source_kind,
        source_version=excluded.source_version,status='active',updated_at=excluded.updated_at`).run(
        normalizedSourceId, clean(sourceKind) || 'document', normalizedVersion, timestamp);
      db.prepare(`INSERT INTO document_generations(generation_id,source_id,source_version,status,created_at)
        VALUES(?,?,?,'building',?)`).run(generationId, normalizedSourceId, normalizedVersion, timestamp);
      db.prepare(`UPDATE kg_source_versions SET state='stale' WHERE source_id=? AND source_version<>? AND state='current'`)
        .run(normalizedSourceId, normalizedVersion);
      const insert = db.prepare(`INSERT INTO parse_partitions(partition_id,generation_id,partition_index,physical_start,
        physical_end,input_hash,status,updated_at) VALUES(?,?,?,?,?,?,'pending',?)`);
      ordered.forEach((part) => insert.run(`${generationId}:${part.index}`, generationId, part.index,
        part.startPage, part.endPage, part.inputHash, timestamp));
    });
    return { generationId, sourceId: normalizedSourceId, sourceVersion: normalizedVersion, partitionCount: ordered.length };
  }
  function setPartitionStatus(generationId, index, status) {
    if (!['running', 'complete', 'error', 'cancelled'].includes(status)) throw new TypeError('Invalid parse partition status.');
    return withTransaction(db, () => {
      const row = db.prepare(`SELECT p.partition_id AS id,g.status AS generationStatus,s.source_version AS currentVersion,
        g.source_version AS sourceVersion FROM parse_partitions p JOIN document_generations g USING(generation_id)
        JOIN source_documents s USING(source_id) WHERE p.generation_id=? AND p.partition_index=?`).get(generationId, index);
      if (!row || row.generationStatus !== 'building' || row.currentVersion !== row.sourceVersion) return false;
      if (status === 'complete') {
        const result = db.prepare("UPDATE parse_partitions SET status='complete',updated_at=? WHERE partition_id=? AND status IN ('pending','running','error')").run(Date.now(), row.id);
        return result.changes === 1;
      }
      const result = db.prepare(`UPDATE parse_partitions SET status=?,updated_at=? WHERE partition_id=?
        AND (status IN ('pending','running','error') OR (status='complete' AND ?='running'))`)
        .run(status, Date.now(), row.id, status);
      return result.changes === 1;
    });
  }
  function setPartitionArtifacts(generationId, index, { stagedPath, manifest, pageCount, blockCount }) {
    const normalizedPath = clean(stagedPath);
    if (!normalizedPath || !Array.isArray(manifest) || manifest.length === 0 ||
      !Number.isSafeInteger(pageCount) || pageCount < 1 || !Number.isSafeInteger(blockCount) || blockCount < 0) return false;
    const normalizedManifest = manifest.map((entry) => ({
      path: clean(entry?.path), size: Number(entry?.size), sha256: clean(entry?.sha256),
    }));
    if (normalizedManifest.some((entry) => !entry.path || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/i.test(entry.sha256)) ||
      new Set(normalizedManifest.map((entry) => entry.path)).size !== normalizedManifest.length) return false;
    return withTransaction(db, () => {
      const row = db.prepare(`SELECT p.partition_id AS id,g.status AS generationStatus,s.source_version AS currentVersion,
        g.source_version AS sourceVersion FROM parse_partitions p JOIN document_generations g USING(generation_id)
        JOIN source_documents s USING(source_id) WHERE p.generation_id=? AND p.partition_index=?`).get(generationId, index);
      if (!row || row.generationStatus !== 'building' || row.currentVersion !== row.sourceVersion) return false;
      return db.prepare(`UPDATE parse_partitions SET staged_path=?,staged_manifest=?,updated_at=?
        WHERE partition_id=? AND status='running'`).run(normalizedPath,
        JSON.stringify({ version: 1, entries: normalizedManifest, pageCount, blockCount }), Date.now(), row.id).changes === 1;
    });
  }
  function clearPartitionArtifacts(generationId, index) {
    return db.prepare(`UPDATE parse_partitions SET staged_path=NULL,staged_manifest=NULL,updated_at=?
      WHERE generation_id=? AND partition_index=? AND status='running'`).run(Date.now(), generationId, index).changes === 1;
  }
  function setPartitionRemoteJobId(generationId, index, remoteJobId) {
    const normalizedJobId = clean(remoteJobId);
    if (!normalizedJobId) return false;
    return withTransaction(db, () => {
      const row = db.prepare(`SELECT p.partition_id AS id,g.status AS generationStatus,
        s.source_version AS currentVersion,g.source_version AS sourceVersion FROM parse_partitions p
        JOIN document_generations g USING(generation_id) JOIN source_documents s USING(source_id)
        WHERE p.generation_id=? AND p.partition_index=?`).get(generationId, index);
      if (!row || row.generationStatus !== 'building' || row.currentVersion !== row.sourceVersion) return false;
      return db.prepare(`UPDATE parse_partitions SET remote_job_id=?,updated_at=?
        WHERE partition_id=? AND status='running'`).run(normalizedJobId, Date.now(), row.id).changes === 1;
    });
  }
  function failGeneration(generationId, status = 'error') {
    if (!['error', 'cancelled'].includes(status)) throw new TypeError('Invalid terminal generation status.');
    withTransaction(db, () => {
      db.prepare("UPDATE document_generations SET status=? WHERE generation_id=? AND status='building'").run(status, generationId);
      db.prepare("UPDATE parse_partitions SET status=?,updated_at=? WHERE generation_id=? AND status IN ('pending','running')").run(status, Date.now(), generationId);
    });
  }
  function setGenerationArtifacts(generationId, { artifactPath, manifest }) {
    const normalizedPath = clean(artifactPath);
    if (!normalizedPath || !Array.isArray(manifest) || manifest.length === 0) return false;
    const normalizedManifest = manifest.map((entry) => ({
      path: clean(entry?.path),
      size: Number(entry?.size),
      sha256: clean(entry?.sha256),
    }));
    if (normalizedManifest.some((entry) => !entry.path || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/i.test(entry.sha256))) return false;
    const uniquePaths = new Set(normalizedManifest.map((entry) => entry.path));
    if (uniquePaths.size !== normalizedManifest.length) return false;
    return withTransaction(db, () => {
      const row = db.prepare(`SELECT g.status,s.source_version AS currentVersion,g.source_version AS sourceVersion
        FROM document_generations g JOIN source_documents s USING(source_id) WHERE generation_id=?`).get(generationId);
      if (!row || row.status !== 'building' || row.currentVersion !== row.sourceVersion) return false;
      return db.prepare('UPDATE document_generations SET artifact_path=?,artifact_manifest=? WHERE generation_id=? AND status=\'building\'')
        .run(normalizedPath, JSON.stringify(normalizedManifest), generationId).changes === 1;
    });
  }
  function publishGeneration(generationId, { sourceVersion, expectedPageCount, pageMappings }) {
    if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount < 1 || !clean(sourceVersion)) return false;
    return withTransaction(db, () => {
      const generation = db.prepare(`SELECT g.source_id AS sourceId,g.source_version AS sourceVersion,g.status,
        g.artifact_path AS artifactPath,g.artifact_manifest AS artifactManifest,
        s.source_version AS currentVersion FROM document_generations g JOIN source_documents s USING(source_id)
        WHERE g.generation_id=?`).get(generationId);
      if (!generation || generation.status !== 'building' || generation.sourceVersion !== sourceVersion || generation.currentVersion !== sourceVersion || !generation.artifactPath || !generation.artifactManifest) return false;
      let manifest;
      try { manifest = JSON.parse(generation.artifactManifest); } catch { return false; }
      if (!Array.isArray(manifest) || manifest.length === 0 || manifest.some((entry) => !clean(entry?.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/i.test(clean(entry.sha256)))) return false;
      const parts = db.prepare('SELECT partition_index AS partIndex,physical_start AS startPage,physical_end AS endPage,status FROM parse_partitions WHERE generation_id=? ORDER BY partition_index').all(generationId);
      if (!parts.length || parts.some((part) => part.status !== 'complete')) return false;
      let nextPage = 1;
      for (let index = 0; index < parts.length; index += 1) {
        if (parts[index].partIndex !== index || parts[index].startPage !== nextPage) return false;
        nextPage = parts[index].endPage + 1;
      }
      if (nextPage !== expectedPageCount + 1) return false;
      const timestamp = Date.now();
      const mappingByPage = new Map();
      if (pageMappings !== undefined) {
        if (!Array.isArray(pageMappings) || pageMappings.length !== expectedPageCount) return false;
        for (const mapping of pageMappings) {
          const physicalPage = Number(mapping?.physicalPage);
          const unitId = clean(mapping?.unitId);
          const mappingRevision = clean(mapping?.mappingRevision);
          if (!Number.isSafeInteger(physicalPage) || physicalPage < 1 || physicalPage > expectedPageCount ||
            mappingByPage.has(physicalPage) || !unitId || !mappingRevision) return false;
          const unit = db.prepare(`SELECT physical_start AS physicalStart,physical_end AS physicalEnd FROM document_units
            WHERE generation_id=? AND unit_id=?`).get(generationId, unitId);
          if (!unit || physicalPage < unit.physicalStart || physicalPage > unit.physicalEnd) return false;
          mappingByPage.set(physicalPage, { unitId, mappingRevision, printedPage: clean(mapping?.printedPage) || null });
        }
        if (mappingByPage.size !== expectedPageCount) return false;
      }
      const insertPage = db.prepare(`INSERT INTO document_pages(generation_id,physical_page,printed_page,unit_id,mapping_revision)
        VALUES(?,?,?,?,?)`);
      const insertMappingRevision = db.prepare(`INSERT INTO document_page_revisions(generation_id,physical_page,
        mapping_revision,printed_page,unit_id,created_at) VALUES(?,?,?,?,?,?)`);
      for (let page = 1; page <= expectedPageCount; page += 1) {
        const mapping = mappingByPage.get(page);
        insertPage.run(generationId, page, mapping?.printedPage ?? null, mapping?.unitId ?? null, mapping?.mappingRevision ?? '');
        if (mapping) insertMappingRevision.run(generationId, page, mapping.mappingRevision, mapping.printedPage, mapping.unitId, timestamp);
      }
      db.prepare('UPDATE document_generations SET status=\'published\',published_at=? WHERE generation_id=?').run(timestamp, generationId);
      db.prepare('UPDATE source_documents SET current_generation=?,updated_at=? WHERE source_id=? AND source_version=?').run(generationId, timestamp, generation.sourceId, sourceVersion);
      const contentSignature = crypto.createHash('sha256').update(JSON.stringify(manifest.slice()
        .sort((left, right) => left.path.localeCompare(right.path)))).digest('hex');
      db.prepare(`UPDATE kg_source_versions SET state='stale' WHERE source_id=? AND source_type='paddle-normalized'
        AND state='current' AND parse_generation<>?`).run(generation.sourceId, generationId);
      db.prepare(`INSERT INTO kg_source_versions(source_version_id,source_id,source_version,source_type,role_snapshot,
        content_signature,parse_generation,state,created_at) VALUES(?,?,?,'paddle-normalized',?,?,?,'current',?)
        ON CONFLICT(source_version_id) DO UPDATE SET state='current',content_signature=excluded.content_signature,
        parse_generation=excluded.parse_generation`).run(`parse:${generationId}`, generation.sourceId, sourceVersion,
        JSON.stringify({ role: 'parsed-fulltext' }), contentSignature, generationId, timestamp);
      return true;
    });
  }
  function upsertDocumentUnits(generationId, units) {
    const targetGeneration = clean(generationId);
    if (!targetGeneration || !Array.isArray(units) || units.length === 0) throw new TypeError('A generation and at least one document unit are required.');
    const normalized = units.map((unit) => ({
      unitId: clean(unit?.unitId),
      parentUnitId: clean(unit?.parentUnitId) || null,
      unitKind: clean(unit?.unitKind),
      ordinal: Number(unit?.ordinal),
      title: typeof unit?.title === 'string' ? unit.title : null,
      physicalStart: Number(unit?.physicalStart),
      physicalEnd: Number(unit?.physicalEnd),
      printedStart: clean(unit?.printedStart) || null,
      printedEnd: clean(unit?.printedEnd) || null,
      unitRevision: clean(unit?.unitRevision),
      contentHash: clean(unit?.contentHash) || null,
      content: typeof unit?.content === 'string' ? unit.content : null,
    }));
    const ids = new Set();
    for (const unit of normalized) {
      if (!unit.unitId || ids.has(unit.unitId) || !unit.unitKind || !unit.unitRevision || !Number.isSafeInteger(unit.ordinal) || unit.ordinal < 0 ||
        !Number.isSafeInteger(unit.physicalStart) || unit.physicalStart < 1 || !Number.isSafeInteger(unit.physicalEnd) ||
        unit.physicalEnd < unit.physicalStart) throw new TypeError('Document units require unique IDs, kinds, non-negative ordinals, and valid 1-based physical page ranges.');
      ids.add(unit.unitId);
    }
    return withTransaction(db, () => {
      const generation = db.prepare('SELECT generation_id AS generationId,status FROM document_generations WHERE generation_id=?').get(targetGeneration);
      if (!generation || !['building', 'published'].includes(generation.status)) return false;
      const existing = db.prepare('SELECT unit_id AS unitId,parent_unit_id AS parentUnitId FROM document_units WHERE generation_id=?')
        .all(targetGeneration);
      const parentById = new Map(existing.map((unit) => [unit.unitId, unit.parentUnitId]));
      for (const unit of normalized) parentById.set(unit.unitId, unit.parentUnitId);
      for (const unit of normalized) {
        if (unit.parentUnitId && !parentById.has(unit.parentUnitId)) throw new Error(`Parent unit ${unit.parentUnitId} is not part of this generation.`);
        const seen = new Set([unit.unitId]);
        let parentId = unit.parentUnitId;
        while (parentId) {
          if (seen.has(parentId)) throw new Error('Document unit hierarchy cannot contain a cycle.');
          seen.add(parentId);
          parentId = parentById.get(parentId) || null;
        }
        const owner = db.prepare('SELECT generation_id AS generationId FROM document_units WHERE unit_id=?').get(unit.unitId);
        if (owner && owner.generationId !== targetGeneration) throw new Error(`Document unit ${unit.unitId} belongs to another generation.`);
      }
      const save = db.prepare(`INSERT INTO document_units(unit_id,generation_id,parent_unit_id,unit_kind,ordinal,title,
        physical_start,physical_end,printed_start,printed_end,unit_revision,content_hash,content) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(unit_id) DO UPDATE SET parent_unit_id=excluded.parent_unit_id,unit_kind=excluded.unit_kind,
        ordinal=excluded.ordinal,title=excluded.title,physical_start=excluded.physical_start,physical_end=excluded.physical_end,
        printed_start=excluded.printed_start,printed_end=excluded.printed_end,unit_revision=excluded.unit_revision,
        content_hash=excluded.content_hash,content=excluded.content`);
      const readRevision = db.prepare(`SELECT parent_unit_id AS parentUnitId,unit_kind AS unitKind,ordinal,title,
        physical_start AS physicalStart,physical_end AS physicalEnd,printed_start AS printedStart,printed_end AS printedEnd,
        content_hash AS contentHash,content FROM document_unit_revisions WHERE generation_id=? AND unit_id=? AND unit_revision=?`);
      const saveRevision = db.prepare(`INSERT OR IGNORE INTO document_unit_revisions(generation_id,unit_id,unit_revision,
        parent_unit_id,unit_kind,ordinal,title,physical_start,physical_end,printed_start,printed_end,content_hash,content,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const unit of normalized) {
        const priorRevision = readRevision.get(targetGeneration, unit.unitId, unit.unitRevision);
        const revisionContent = {
          parentUnitId: unit.parentUnitId, unitKind: unit.unitKind, ordinal: unit.ordinal, title: unit.title,
          physicalStart: unit.physicalStart, physicalEnd: unit.physicalEnd, printedStart: unit.printedStart,
          printedEnd: unit.printedEnd, contentHash: unit.contentHash, content: unit.content,
        };
        if (priorRevision && JSON.stringify(priorRevision) !== JSON.stringify(revisionContent)) {
          throw new Error(`Unit revision ${unit.unitRevision} for ${unit.unitId} is immutable and already has different content.`);
        }
        saveRevision.run(targetGeneration, unit.unitId, unit.unitRevision, unit.parentUnitId, unit.unitKind,
          unit.ordinal, unit.title, unit.physicalStart, unit.physicalEnd, unit.printedStart, unit.printedEnd,
          unit.contentHash, unit.content, Date.now());
        save.run(unit.unitId, targetGeneration, unit.parentUnitId, unit.unitKind, unit.ordinal,
          unit.title, unit.physicalStart, unit.physicalEnd, unit.printedStart, unit.printedEnd, unit.unitRevision,
          unit.contentHash, unit.content);
      }
      return true;
    });
  }
  function assignDocumentPages(generationId, pages) {
    const targetGeneration = clean(generationId);
    if (!targetGeneration || !Array.isArray(pages) || pages.length === 0) throw new TypeError('A generation and at least one page mapping are required.');
    const normalized = pages.map((page) => ({
      physicalPage: Number(page?.physicalPage),
      printedPage: clean(page?.printedPage) || null,
      unitId: clean(page?.unitId) || null,
      mappingRevision: clean(page?.mappingRevision),
    }));
    const pageIds = new Set();
    for (const page of normalized) {
      if (!Number.isSafeInteger(page.physicalPage) || page.physicalPage < 1 || pageIds.has(page.physicalPage) || !page.mappingRevision) {
        throw new TypeError('Page mappings require unique positive 1-based physical page numbers and an explicit mapping revision.');
      }
      pageIds.add(page.physicalPage);
    }
    return withTransaction(db, () => {
      for (const page of normalized) {
        const exists = db.prepare('SELECT 1 AS found FROM document_pages WHERE generation_id=? AND physical_page=?')
          .get(targetGeneration, page.physicalPage);
        if (!exists) throw new Error(`Physical page ${page.physicalPage} is not present in this generation.`);
        if (page.unitId) {
          const unit = db.prepare(`SELECT physical_start AS startPage,physical_end AS endPage FROM document_units
            WHERE generation_id=? AND unit_id=?`).get(targetGeneration, page.unitId);
          if (!unit) throw new Error(`Document unit ${page.unitId} is not part of this generation.`);
          if (page.physicalPage < unit.startPage || page.physicalPage > unit.endPage) {
            throw new Error(`Physical page ${page.physicalPage} is outside unit ${page.unitId}'s range.`);
          }
        }
      }
      const readRevision = db.prepare(`SELECT printed_page AS printedPage,unit_id AS unitId FROM document_page_revisions
        WHERE generation_id=? AND physical_page=? AND mapping_revision=?`);
      const saveRevision = db.prepare(`INSERT OR IGNORE INTO document_page_revisions(generation_id,physical_page,
        mapping_revision,printed_page,unit_id,created_at) VALUES(?,?,?,?,?,?)`);
      const save = db.prepare(`INSERT INTO document_pages(generation_id,physical_page,printed_page,unit_id,mapping_revision)
        VALUES(?,?,?,?,?) ON CONFLICT(generation_id,physical_page) DO UPDATE SET printed_page=excluded.printed_page,
        unit_id=excluded.unit_id,mapping_revision=excluded.mapping_revision`);
      for (const page of normalized) {
        const previous = readRevision.get(targetGeneration, page.physicalPage, page.mappingRevision);
        const revisionContent = { printedPage: page.printedPage, unitId: page.unitId };
        if (previous && JSON.stringify(previous) !== JSON.stringify(revisionContent)) {
          throw new Error(`Page mapping revision ${page.mappingRevision} for physical page ${page.physicalPage} is immutable.`);
        }
        saveRevision.run(targetGeneration, page.physicalPage, page.mappingRevision, page.printedPage, page.unitId, Date.now());
        save.run(targetGeneration, page.physicalPage, page.printedPage, page.unitId, page.mappingRevision);
      }
      return true;
    });
  }
  const legacyPath = path.join(appPaths.dataDir, 'paperquay-knowledge-graph-relations.json');
  const migrated = db.prepare("SELECT value FROM knowledge_meta WHERE key='legacy_relations_json_v1'").get();
  if (!migrated && fs.existsSync(legacyPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      if (!Array.isArray(raw?.relations)) throw new Error('Legacy knowledge graph relation file is invalid; migration was not marked complete.');
      withTransaction(db, () => {
        for (const row of raw.relations) {
          const id = clean(row?.id); const source = clean(row?.source || row?.sourceId); const target = clean(row?.target || row?.targetId);
          if (!id || !source || !target || source === target) continue;
          const createdAt = Number(row.createdAt) || Date.now();
          writeRelation({ id, source, target, type: row.type === 'ai_suggested' ? 'ai_suggested' : 'custom_relation',
            label: clean(row.label) || 'related', description: clean(row.description),
            confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
            weight: Number.isFinite(Number(row.weight)) ? Number(row.weight) : null,
            createdAt, updatedAt: Number(row.updatedAt) || createdAt });
        }
        db.prepare("INSERT INTO knowledge_meta(key,value) VALUES('legacy_relations_json_v1','complete')").run();
      });
    } catch (error) {
      if (db.isOpen) db.close();
      throw error;
    }
  }
  return {
    listRelations() {
      return db.prepare('SELECT id,source_id AS source,target_id AS target,relation_type AS type,label,description,confidence,weight,created_at AS createdAt,updated_at AS updatedAt FROM kg_custom_relations ORDER BY created_at,id').all();
    },
    saveRelation(relation) { withTransaction(db, () => writeRelation(relation)); return relation; },
    deleteRelation(id) { return db.prepare('DELETE FROM kg_custom_relations WHERE id=?').run(clean(id)).changes > 0; },
    registerSourceVersion,
    listSourceVersions(sourceId) {
      return db.prepare(`SELECT source_version_id AS sourceVersionId,source_id AS sourceId,source_version AS sourceVersion,
        source_type AS sourceType,role_snapshot AS roleSnapshotJson,content_signature AS contentSignature,
        parse_generation AS parseGeneration,state,created_at AS createdAt FROM kg_source_versions
        WHERE source_id=? ORDER BY created_at,source_version_id`).all(clean(sourceId)).map((row) => {
          let roleSnapshot = {};
          try { roleSnapshot = JSON.parse(row.roleSnapshotJson); } catch {}
          const { roleSnapshotJson, ...source } = row;
          return { ...source, roleSnapshot };
        });
    },
    createEvidenceSpan,
    getEvidenceSpan,
    upsertDocumentUnits,
    assignDocumentPages,
    listDocumentUnits(generationId) {
      return db.prepare(`SELECT unit_id AS unitId,parent_unit_id AS parentUnitId,unit_kind AS unitKind,ordinal,title,
        physical_start AS physicalStart,physical_end AS physicalEnd,printed_start AS printedStart,printed_end AS printedEnd,
        unit_revision AS unitRevision,content_hash AS contentHash,content FROM document_units WHERE generation_id=? ORDER BY ordinal,unit_id`).all(clean(generationId));
    },
    listDocumentUnitRevisions(generationId, unitId) {
      return db.prepare(`SELECT unit_id AS unitId,unit_revision AS unitRevision,parent_unit_id AS parentUnitId,
        unit_kind AS unitKind,ordinal,title,physical_start AS physicalStart,physical_end AS physicalEnd,
        printed_start AS printedStart,printed_end AS printedEnd,content_hash AS contentHash,content,created_at AS createdAt
        FROM document_unit_revisions WHERE generation_id=? AND unit_id=? ORDER BY created_at,unit_revision`)
        .all(clean(generationId), clean(unitId));
    },
    listDocumentPages(generationId) {
      return db.prepare(`SELECT physical_page AS physicalPage,printed_page AS printedPage,unit_id AS unitId,
        mapping_revision AS mappingRevision
        FROM document_pages WHERE generation_id=? ORDER BY physical_page`).all(clean(generationId));
    },
    listDocumentPageRevisions(generationId, physicalPage) {
      return db.prepare(`SELECT physical_page AS physicalPage,mapping_revision AS mappingRevision,
        printed_page AS printedPage,unit_id AS unitId,created_at AS createdAt FROM document_page_revisions
        WHERE generation_id=? AND physical_page=? ORDER BY created_at,mapping_revision`)
        .all(clean(generationId), Number(physicalPage));
    },
    recordReviewEvent,
    listReviewEvents(objectType, objectId) {
      return db.prepare(`SELECT review_event_id AS reviewEventId,object_type AS objectType,object_id AS objectId,
        object_revision AS objectRevision,decision,reviewer,reason,created_at AS createdAt FROM kg_review_events
        WHERE object_type=? AND object_id=? ORDER BY created_at,review_event_id`).all(clean(objectType), clean(objectId));
    },
    beginGeneration,
    findBuildingGeneration(sourceId, sourceVersion, partitions) {
      const source = clean(sourceId); const version = clean(sourceVersion);
      if (!source || !version || !Array.isArray(partitions) || partitions.length === 0) return null;
      const candidates = db.prepare(`SELECT g.generation_id AS generationId,g.source_id AS sourceId,
        g.source_version AS sourceVersion FROM document_generations g JOIN source_documents s USING(source_id)
        WHERE g.source_id=? AND g.source_version=? AND s.source_version=? AND g.status='building'
        ORDER BY g.created_at DESC`).all(source, version, version);
      for (const candidate of candidates) {
        const stored = db.prepare(`SELECT partition_index AS partitionIndex,physical_start AS startPage,
          physical_end AS endPage,input_hash AS inputHash FROM parse_partitions
          WHERE generation_id=? ORDER BY partition_index`).all(candidate.generationId);
        if (stored.length !== partitions.length) continue;
        if (!stored.every((item, index) => item.partitionIndex === partitions[index].index &&
          item.startPage === partitions[index].startPage && item.endPage === partitions[index].endPage &&
          item.inputHash === partitions[index].inputHash)) continue;
        return { ...candidate, partitionCount: stored.length };
      }
      return null;
    },
    setPartitionStatus,
    setPartitionRemoteJobId,
    failGeneration,
    setGenerationArtifacts,
    publishGeneration,
    listGenerations(sourceId) {
      return db.prepare(`SELECT g.generation_id AS generationId,g.source_version AS sourceVersion,g.status,g.created_at AS createdAt,
        g.published_at AS publishedAt,s.current_generation AS currentGeneration,s.source_version AS activeSourceVersion
        FROM document_generations g JOIN source_documents s USING(source_id) WHERE g.source_id=? ORDER BY g.created_at DESC`)
        .all(clean(sourceId));
    },
    listGenerationArtifacts(sourceId) {
      return db.prepare(`SELECT g.generation_id AS generationId,g.source_version AS sourceVersion,g.status,
        g.artifact_path AS artifactPath,g.artifact_manifest AS artifactManifest,
        s.current_generation AS currentGeneration FROM document_generations g
        JOIN source_documents s USING(source_id) WHERE g.source_id=? AND g.status='published'
        AND g.artifact_path IS NOT NULL AND g.artifact_manifest IS NOT NULL ORDER BY g.created_at DESC`)
        .all(clean(sourceId)).map((row) => {
          let manifest = [];
          try {
            const parsed = JSON.parse(row.artifactManifest);
            if (Array.isArray(parsed)) manifest = parsed;
          } catch {}
          return { ...row, manifest };
        });
    },
    listGenerationPartitions(generationId) {
      return db.prepare(`SELECT partition_index AS partitionIndex,physical_start AS startPage,physical_end AS endPage,
        input_hash AS inputHash,status,staged_path AS stagedPath,staged_manifest AS stagedManifestJson,
        remote_job_id AS remoteJobId,updated_at AS updatedAt
        FROM parse_partitions WHERE generation_id=? ORDER BY partition_index`).all(clean(generationId)).map((row) => {
          let stagedManifest = null;
          try { stagedManifest = row.stagedManifestJson ? JSON.parse(row.stagedManifestJson) : null; } catch {}
          const { stagedManifestJson, ...partition } = row;
          return { ...partition, stagedManifest };
        });
    },
    setPartitionArtifacts,
    clearPartitionArtifacts,
    snapshotTo(targetPath) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true }); fs.rmSync(targetPath, { force: true });
      db.exec(`VACUUM main INTO ${sqlStringLiteral(targetPath)}`); return targetPath;
    },
    close() { if (db.isOpen) db.close(); },
  };
}

module.exports = { createKnowledgeStore };
