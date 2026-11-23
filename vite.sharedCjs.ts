/**
 * Vite dev 转换：`src/shared/*.cjs` 同时被 Electron（CommonJS）和渲染层（ESM）引用。
 * 生产构建里 Rollup 能处理 CJS 互操作，但 dev server 会原样返回 `module.exports`，
 * 浏览器链接期就会报 “does not provide an export named ...”。
 *
 * 这里只做一件事：把末尾的 `module.exports = { a, b };` 替换成显式 `export { a, b };`。
 * 新增 shared CJS 时保持这种收尾写法即可自动生效。
 */

const SHARED_CJS_ID_PATTERN = /\/src\/shared\/[^/]+\.cjs$/;
const MODULE_EXPORTS_PATTERN = /module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

export function isSharedCjsModuleId(id: string): boolean {
  return SHARED_CJS_ID_PATTERN.test(id.split('?')[0].replace(/\\/g, '/'));
}

export function transformSharedCjsForDev(code: string, id: string): string | null {
  if (!isSharedCjsModuleId(id)) {
    return null;
  }

  const match = MODULE_EXPORTS_PATTERN.exec(code);

  if (!match) {
    throw new Error(
      `Cannot convert shared CJS module to ESM for dev: ${id}. ` +
        'Expected a trailing `module.exports = { ... };` statement.',
    );
  }

  // 逐项解析：支持 `name` 与 `local: exported` 两种写法。
  const exportSpecifiers = match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [left, right, ...rest] = entry.split(':').map((part) => part.trim());

      if (rest.length > 0) {
        throw new Error(
          `Cannot convert shared CJS module to ESM for dev: ${id}. ` +
            `Unsupported export entry "${entry}".`,
        );
      }

      const local = left;
      const exported = right ?? left;

      if (!IDENTIFIER_PATTERN.test(local) || !IDENTIFIER_PATTERN.test(exported)) {
        throw new Error(
          `Cannot convert shared CJS module to ESM for dev: ${id}. ` +
            `Unsupported export entry "${entry}".`,
        );
      }

      return local === exported ? local : `${local} as ${exported}`;
    });

  if (exportSpecifiers.length === 0) {
    throw new Error(
      `Cannot convert shared CJS module to ESM for dev: ${id}. ` +
        'Only plain identifier exports are supported.',
    );
  }

  return `${code.slice(0, match.index)}export { ${exportSpecifiers.join(', ')} };\n`;
}
