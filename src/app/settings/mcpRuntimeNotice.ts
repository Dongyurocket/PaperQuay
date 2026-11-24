import type { SettingsLocalizer } from './settingsTypes';

/** mcp_get_client_config 返回的 MCP 运行时状态（见 electron/backend/mcpClientConfig.cjs）。 */
export interface McpRuntimeInfo {
  mode: 'stable' | 'appdir' | 'mount' | 'installed' | 'source';
  prepared: boolean;
  reason?: string;
  warning?: string;
}

// reason 是打包/复制阶段的内部标记，这里只翻译成用户能理解的短语；
// 后端的 English warning 原文仅用于日志，绝不能直接回显到设置页。
const REASON_TEXT: Record<string, { zh: string; en: string }> = {
  'missing-target': { zh: '没有可用的稳定运行时目录', en: 'no stable runtime directory is available' },
  'missing-source': { zh: '安装包内缺少 MCP 服务文件', en: 'the packaged MCP service files are missing' },
  'entry-missing': { zh: '稳定目录缺少服务入口', en: 'the stable directory is missing the service entry' },
  'prepare-error': { zh: '复制稳定运行时目录失败', en: 'copying the stable runtime directory failed' },
  'runtime-not-prepared': { zh: '稳定目录未准备好', en: 'the stable runtime directory is not ready' },
};

const FALLBACK_REASON = { zh: '稳定目录未准备好', en: 'the stable runtime directory is not ready' };

/**
 * 把 MCP runtime 状态转成设置页告警：
 * - appdir：稳定目录已就绪，但 command 仍指向 APPDIR 临时挂载；提醒设置 APPIMAGE；
 * - mount：稳定目录未就绪、片段回退到临时挂载；按 reason 说明；
 * - stable/installed/source：入口本身稳定或开发态，返回 null。
 */
export function describeMcpRuntimeNotice(
  runtime: McpRuntimeInfo | null | undefined,
  l: SettingsLocalizer,
): string | null {
  if (!runtime) return null;

  if (runtime.mode === 'appdir') {
    return l(
      'MCP 配置片段可启动，但 command 仍指向 APPDIR 临时挂载目录，AppImage 重新挂载后会失效。请设置 APPIMAGE 环境变量后重新生成配置，让 command 指向稳定的 AppImage 文件。',
      'The MCP config snippet works, but command still points into the temporary APPDIR mount and stops working after the AppImage is remounted. Set APPIMAGE and regenerate the config so command points at the stable AppImage file.',
    );
  }

  if (runtime.mode !== 'mount') return null;

  const reason = REASON_TEXT[runtime.reason ?? ''] ?? FALLBACK_REASON;
  return l(
    `MCP 稳定运行时尚未就绪（${reason.zh}）：配置片段仍指向临时挂载路径，AppImage 重新挂载后会失效。请让应用完成稳定运行时准备后重新打开此页，或设置 APPIMAGE 环境变量后重新生成配置。`,
    `The stable MCP runtime is not ready (${reason.en}): the config snippet still points into the temporary mount and stops working after the AppImage is remounted. Let the app finish preparing the stable runtime and reopen this page, or set APPIMAGE and regenerate the config.`,
  );
}
