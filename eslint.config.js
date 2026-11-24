import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// 公共规则：保守但能挡住真实缺陷（未定义变量、不可达代码、重复键等）
const sharedRules = {
  'no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-keys': 'error',
  'no-fallthrough': 'error',
};

// TS 侧使用 @typescript-eslint/no-unused-vars 取代核心规则；
// no-undef 交给 TypeScript 编译器，避免把类型/全局声明误判为未定义。
const tsSharedRules = {
  'no-unused-vars': 'off',
  // TS 文件由 TypeScript 编译器负责未定义标识符检查
  'no-undef': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-keys': 'error',
  'no-fallthrough': 'error',
};

// typescript-eslint 的 recommended 默认作用于所有文件，这里收窄到 TS 源码，
// 避免 no-require-imports 等规则误伤 .cjs。
const tsRecommended = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: ['**/*.{ts,tsx}'],
}));

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-release/**',
      'release/**',
      'packaging/**',
      'docs/**',
      'assets/**',
      '.verification-*/**',
      '.codex-temp/**',
      '.tmp-*/**',
      // 生成的 preload 打包产物，不参与源码检查
      'electron/preload.bundle.cjs',
      // 本机未跟踪的个人脚本（AGENTS.md：不改、不删、不提交），不纳入仓库检查
      'scripts/inspect-library.cjs',
      'scripts/rag-embed-probe.mjs',
    ],
  },
  js.configs.recommended,
  {
    // 项目里大量 best-effort 清理使用空 catch（如关闭句柄、清理临时文件），
    // 允许空 catch，其余空块仍然报错。
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  ...tsRecommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsSharedRules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['electron/**/*.{cjs,mjs,js}', 'scripts/**/*.{cjs,mjs,js}', 'bin/**/*.{cjs,mjs,js}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: sharedRules,
  },
  {
    files: ['electron/**/*.mjs', 'scripts/**/*.mjs', 'bin/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['src/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: sharedRules,
  },
  {
    files: ['tests/**/*.{ts,tsx,mjs,cjs}'],
    languageOptions: {
      // 测试运行在 Node 中，同时用 jsdom 提供浏览器全局量
      globals: { ...globals.node, ...globals.browser },
    },
    rules: sharedRules,
  },
  {
    files: ['electron/preload.cjs'],
    languageOptions: {
      // preload 运行在渲染进程上下文，同时可访问 Node API
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      ...tsSharedRules,
      // 测试用 any 构造纯 JS 模块桩（module.exports、globalThis 注入），
      // 发布代码仍保持 error。
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['*.{ts,cjs,mjs,js}'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
