; PaperQuay 自定义 NSIS 安装脚本
;
; 覆盖 electron-builder 默认的 CHECK_APP_RUNNING 检测逻辑。
; 默认实现（templates/nsis/include/allowOnlyOneInstallerInstance.nsh）在检测到
; 安装目录下存在进程时会弹窗要求用户手动关闭，杀不掉则死循环提示，导致
; "窗口早已关闭但安装器仍报正在运行"（残留的无窗口 Electron 子进程，
; 如 renderer / gpu / utility / crashpad-handler，进程名都是 PaperQuay.exe）。
;
; 这里改为：自动结束安装目录下的残留进程并等待重试，仅多次强杀失败后才提示用户。
;
; 说明：
; - $PowerShellPath / $CmdPath 由外层 CHECK_APP_RUNNING 宏在插入本宏前定义。
; - nsProcess.nsh 无论是否定义 customCheckAppRunning 都会被包含，可直接使用。
; - 本宏同时作用于安装段和卸载段（两处都会插入 CHECK_APP_RUNNING）。

!macro customCheckAppRunning
  Var /GLOBAL pqRetry
  StrCpy $pqRetry 0

  pq_check_running:
    ; 优先按可执行文件路径匹配（与默认实现一致，只针对本应用的安装目录）
    nsExec::Exec `"$PowerShellPath" -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop $R0
    ${if} $R0 == 0
      Goto pq_found
    ${endIf}
    ; PowerShell 不可用时退化为按进程名检测
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      Goto pq_found
    ${endIf}
    Goto pq_not_running

  pq_found:
    IntOp $pqRetry $pqRetry + 1
    ${if} $pqRetry > 4
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "PaperQuay 的残留进程无法自动关闭。$\n请打开任务管理器，结束所有 PaperQuay.exe 进程后点击“重试”。" IDRETRY pq_retry_reset
      Quit
      pq_retry_reset:
        StrCpy $pqRetry 0
        Goto pq_check_running
    ${endIf}

    DetailPrint "正在关闭残留的 PaperQuay 进程..."
    ; 按路径精确结束，避免误杀其他目录下的同名进程
    nsExec::Exec `"$PowerShellPath" -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $R0
    ; 兜底按进程名再杀一次，覆盖 PowerShell 不可用的场景
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ; 给进程退出和文件句柄释放留出时间
    Sleep 1500
    Goto pq_check_running

  pq_not_running:
!macroend
