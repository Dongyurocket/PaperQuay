/**
 * PDF 打开/切换的请求代次。
 *
 * 同一阅读标签内，打开文献、切换到原始/批注/项目 PDF、延迟恢复 MinerU
 * 缓存共享一个代次：每次 begin() 都让之前所有在途请求失效，只有最新的
 * 请求能写 pdfSource/currentDocument/loading/error。旧请求既不能覆盖
 * 新文档，也不能在 finally 里提前清掉新请求的 loading。
 */

export interface DocumentOpenGeneration {
  /** 开始一次新的打开/切换，之前的请求全部失效。 */
  begin(): number;
  /** 当前最新代次（用于日志或断言）。 */
  current(): number;
  /** 该代次是否仍是最新请求。 */
  isCurrent(token: number): boolean;
  /**
   * 仅当 token 仍是最新请求时执行提交；返回回调结果，否则返回 undefined。
   * 用于状态写入和 finally 清理，保证旧请求不会产生任何副作用。
   */
  ifCurrent<T>(token: number, commit: () => T): T | undefined;
}

export function createDocumentOpenGeneration(): DocumentOpenGeneration {
  let current = 0;

  return {
    begin(): number {
      current += 1;
      return current;
    },

    current(): number {
      return current;
    },

    isCurrent(token: number): boolean {
      return token === current;
    },

    ifCurrent<T>(token: number, commit: () => T): T | undefined {
      if (token !== current) return undefined;
      return commit();
    },
  };
}
