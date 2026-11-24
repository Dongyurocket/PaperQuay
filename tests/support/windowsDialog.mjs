// Windows 原生文件对话框自动化（UIAutomation），仅用于安装版验收。
// Electron 的 dialog.showOpenDialog 无法通过 CDP 控制，这里在独立的
// Windows PowerShell 5.1 进程里等待对话框、填写文件名并点“打开”。
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PS_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][int]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$FilePath,
  [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$pidCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
  $TargetProcessId
)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$window = $null
$edit = $null
$editIdCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  '1148'
)
$editTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)
while ((Get-Date) -lt $deadline) {
  # 同一进程既有主窗口也有文件对话框；必须逐个顶层窗口找带文件名输入框的那个。
  $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition)
  foreach ($candidate in $windows) {
    $found = $candidate.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editIdCondition)
    if (-not $found) {
      $found = $candidate.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editTypeCondition)
    }
    if ($found) {
      $window = $candidate
      $edit = $found
      break
    }
  }
  if ($window) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $window) { throw "file dialog window not found for pid $TargetProcessId" }

try {
  $valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $valuePattern.SetValue($FilePath)
} catch {
  # 部分 Windows 11 文件对话框的 ValuePattern 只读；退化为剪贴板 + 键盘输入。
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Clipboard]::SetText($FilePath)
  $edit.SetFocus()
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 400

$open = $null
$openIdCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  '1'
)
$open = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $openIdCondition)
if (-not $open) {
  $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  foreach ($button in $buttons) {
    if ($button.Current.Name -match '打开|Open') { $open = $button; break }
  }
}
if (-not $open) { throw 'open button not found' }

$invokePattern = $open.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invokePattern.Invoke()
Write-Output 'ok'
`;

export async function fillWindowsFileDialog({ processId, filePath, timeoutSeconds = 30 }) {
  if (process.platform !== 'win32') {
    throw new Error('Windows file dialog automation is only available on win32');
  }
  const scriptPath = path.join(os.tmpdir(), `pq-uia-${process.pid}-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, PS_SCRIPT, 'utf8');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-TargetProcessId', String(processId),
        '-FilePath', filePath,
        '-TimeoutSeconds', String(timeoutSeconds),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0 && stdout.includes('ok')) resolve();
        else reject(new Error(`UIAutomation failed (code ${code}): ${stderr || stdout}`));
      });
    });
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}
