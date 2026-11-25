/**
 * RAG 索引的抽取器版本号。
 *
 * 实际常量在 ragIndexVersions.cjs 中，供渲染进程与主进程共用；
 * 本文件保留原有 .ts 导入路径，避免调用方大范围改名。
 */
export { MINERU_RAG_EXTRACTOR_VERSION } from './ragIndexVersions.cjs';
