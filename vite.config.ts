import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function manualChunks(id: string) {
  const normalized = id.replace(/\\/g, '/');

  if (!normalized.includes('/node_modules/')) {
    return undefined;
  }

  if (
    normalized.includes('/node_modules/pdfjs-dist/') ||
    normalized.includes('/node_modules/react-pdf/')
  ) {
    return 'vendor-pdf';
  }

  if (
    normalized.includes('/node_modules/lucide-react/')
  ) {
    return 'vendor-icons';
  }

  if (
    normalized.includes('/node_modules/llamaindex/') ||
    normalized.includes('/node_modules/@llamaindex/')
  ) {
    return 'vendor-llamaindex';
  }

  if (
    normalized.includes('/node_modules/katex/') ||
    normalized.includes('/node_modules/react-markdown/') ||
    normalized.includes('/node_modules/rehype-') ||
    normalized.includes('/node_modules/remark-') ||
    normalized.includes('/node_modules/unified/') ||
    normalized.includes('/node_modules/mdast-') ||
    normalized.includes('/node_modules/micromark') ||
    normalized.includes('/node_modules/hast') ||
    normalized.includes('/node_modules/unist-') ||
    normalized.includes('/node_modules/vfile')
  ) {
    return 'vendor-markdown';
  }

  if (
    normalized.includes('/node_modules/react/') ||
    normalized.includes('/node_modules/react-dom/') ||
    normalized.includes('/node_modules/scheduler/') ||
    normalized.includes('/node_modules/zustand/')
  ) {
    return 'vendor-react';
  }

  return 'vendor';
}

export default defineConfig(() => ({
  base: './',
  clearScreen: false,
  plugins: [
    react(),
    {
      name: 'shared-markdown-parser-dev-export',
      apply: 'serve',
      // Vite serves local CJS sources directly in dev; Electron still needs CJS.
      transform(code, id) {
        if (!id.split('?')[0].replace(/\\/g, '/').endsWith('/src/shared/markdownToTiptap.cjs')) {
          return null;
        }
        return {
          code: code.replace(
            'module.exports = { parseMarkdownToTiptap };',
            'export { parseMarkdownToTiptap };',
          ),
          map: null,
        };
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
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
      output: {
        manualChunks,
      },
    },
  },
}));
