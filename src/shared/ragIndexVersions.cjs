'use strict';

/**
 * RAG 索引的抽取器版本号。
 *
 * 版本号参与 mineru-markdown 的 sourceSignature，并在 rag_indexes.extractor_version
 * 中留档：签名变化触发重建，版本不一致则角标显示「RAG 待更新」。
 * 分块规则（表格正文、图注、公式、参考文献条目）变化时必须递增。
 */
const MINERU_RAG_EXTRACTOR_VERSION = 'mineru-chunks-v3';

module.exports = { MINERU_RAG_EXTRACTOR_VERSION };
