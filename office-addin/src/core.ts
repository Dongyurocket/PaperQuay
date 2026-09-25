/**
 * 加载项核心的 IIFE 入口（全局 PaperQuayWord）：不含 UI，供 tests/officeAddin.test.ts 在 vm 沙箱里
 * 加载 ES5 产物，验证「降级到 ES5 + polyfill 后」文档操作与渲染仍然正确。页面本身不加载它。
 */
import './polyfills.ts';

export { createOperations } from './word/operations.ts';
export { createTaskQueue } from './word/queue.ts';
export { createBridgeClient, API_BASE, CLIENT_HEADER } from './bridge/client.ts';
export {
  planRender,
  renderCitations,
  serializeModelXml,
  parseModelXml,
  CITATION_STYLE_IDS,
} from '../../src/shared/citation/index.ts';
