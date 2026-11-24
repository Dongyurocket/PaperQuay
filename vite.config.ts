import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { transformSharedCjsForDev } from './vite.sharedCjs';

const require = createRequire(import.meta.url);
const {
  buildContentSecurityPolicy,
  injectContentSecurityPolicy,
} = require('./electron/appSecurity.cjs') as {
  buildContentSecurityPolicy: (options: { isDev?: boolean; devServerUrl?: string }) => string;
  injectContentSecurityPolicy: (html: string, policy: string) => string;
};

/**
 * D1-13：把 CSP 作为 meta 写进最终 HTML。生产版是 file:// 文档，Electron 的
 * webRequest 不会拦截 file://，meta 才是实际生效路径；开发版按 Vite 的
 * origin/HMR 端口放宽 script-src 与 connect-src。
 */
function contentSecurityPolicyPlugin(): Plugin {
  let isDev = false;
  let devServerUrl = '';

  return {
    name: 'paperquay-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
      const host = typeof config.server.host === 'string' ? config.server.host : '127.0.0.1';
      devServerUrl = config.server.port ? `http://${host}:${config.server.port}` : '';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return injectContentSecurityPolicy(
          html,
          buildContentSecurityPolicy({ isDev, devServerUrl }),
        );
      },
    },
  };
}

// S1：按组切分 vendor。React 运行时优先级最高，否则 @tiptap/react 的
// 「递归包含依赖」会把 react-dom 拖进 vendor-editor，首屏被迫加载整个编辑器包。
const codeSplittingGroups = [
  { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 50 },
  // S1：图谱工作区（KnowledgeGraphWorkspace）静态只依赖 cytoscape；fcose 布局
  // 引擎只在 Web Worker 或主线程回退里动态 import。cytoscape-fcose/cose-base/
  // layout-base 若留在静态 vendor-graph，打开图谱或预加载工作区时就会白付
  // 约 500KB；它们交给自动分块，成为 graphLayoutFallback 的惰性 import chunk。
  { name: 'vendor-graph', test: /node_modules[\\/]cytoscape[\\/]/, priority: 40 },
  {
    name: 'vendor-editor',
    test: /node_modules[\\/](@tiptap|prosemirror-|orderedmap|rope-sequence|w3c-keyname|lowlight|highlight\.js)[\\/]/,
    priority: 30,
  },
  { name: 'vendor-pdf', test: /node_modules[\\/](pdfjs-dist|react-pdf)[\\/]/, priority: 25 },
  { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 25 },
  { name: 'vendor-llamaindex', test: /node_modules[\\/](@?llamaindex)[\\/]/, priority: 25 },
  {
    // 必须高于 vendor-editor：@tiptap/extension-mathematics 依赖 katex，
    // 若编辑器组先递归捕获，katex 会被并进 vendor-editor，首屏的 KaTeX 就被迫带上整个编辑器包。
    name: 'vendor-markdown',
    test: /node_modules[\\/](katex|react-markdown|rehype-|remark-|unified|mdast-|micromark|hast|unist-|vfile)/,
    priority: 45,
  },
  // 兜底 vendor 组不能吞掉 fcose 家族：该组会被入口静态预加载，fcose 一旦
  // 落进来就回到首屏（tests/initialChunks.test.mjs 会检查 vendor-graph 与
  // 初始闭包都不含 fcose 运行时）。排除后它们由自动分块生成惰性 chunk。
  {
    name: 'vendor',
    test: /node_modules[\\/](?!cytoscape-fcose|cose-base|layout-base)/,
    priority: 0,
  },
];

export default defineConfig(() => ({
  base: './',
  clearScreen: false,
  plugins: [
    react(),
    contentSecurityPolicyPlugin(),
    {
      name: 'shared-cjs-dev-export',
      apply: 'serve',
      // Vite dev 直接提供本地 CJS 源码；Electron 侧仍需要 CJS，渲染层要求 ESM。
      transform(code, id) {
        const transformed = transformSharedCjsForDev(code, id);
        return transformed === null ? null : { code: transformed, map: null };
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/electron/**'],
    },
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'chrome120',
    // F5：esbuild 会把临时二进制写到 %TEMP%，本机安全软件会锁住它，
    // 导致 `npm run build` 在 vite:esbuild-transpile 阶段偶发 `Access is denied`。
    // Vite 8 的 oxc 压缩器不依赖 esbuild 临时文件，产物等价。
    minify: 'oxc',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        codeSplitting: { groups: codeSplittingGroups },
      },
    },
  },
}));
