const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const execPromise = util.promisify(exec);

/**
 * Executes a PowerShell script by saving it to a temporary file.
 */
async function runPowerShellScript(scriptContent, scriptName) {
  const tempDir = os.tmpdir();
  const scriptPath = path.join(tempDir, `screenrecorder-${Date.now()}-${scriptName}`);
  try {
    console.log(`Executing PowerShell: ${scriptName}`);
    // Write with UTF-8 BOM for proper Unicode support
    const BOM = '\uFEFF';
    fs.writeFileSync(scriptPath, BOM + scriptContent, 'utf8');
    // Use -OutputFormat Text and set console encoding to UTF-8
    const { stdout, stderr } = await execPromise(
      `chcp 65001 >nul && powershell -ExecutionPolicy Bypass -OutputFormat Text -File "${scriptPath}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stderr.includes('Picked up _JAVA_OPTIONS')) {
       // Only log real errors, some environments have harmless stderr noise
       console.error('PowerShell Stderr:', stderr);
    }
    return stdout;
  } finally {
    if (fs.existsSync(scriptPath)) {
      try { fs.unlinkSync(scriptPath); } catch (e) {}
    }
  }
}

// Get list of all windows
async function getWindows() {
  console.log('Fetching windows via PowerShell...');
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowRect(IntPtr hWnd, ref RECT rect);
    
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$windows = New-Object System.Collections.ArrayList
[Win32]::EnumWindows({
    param($hWnd, $lParam)
    if ([Win32]::IsWindowVisible($hWnd)) {
        $title = New-Object System.Text.StringBuilder 256
        [Win32]::GetWindowText($hWnd, $title, 256) | Out-Null
        $titleStr = $title.ToString()
        if ($titleStr.Length -gt 0) {
            $processId = 0
            [Win32]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null
            $rect = New-Object Win32+RECT
            [Win32]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            
            # Filter out tiny windows and the taskbar
            if ($width -gt 100 -and $height -gt 100 -and $titleStr -ne "Program Manager") {
                $proc = $null
                $procName = ""
                try {
                    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
                    if ($proc) { $procName = $proc.ProcessName }
                } catch {}
                $windows.Add([PSCustomObject]@{
                    Handle = $hWnd.ToInt64()
                    Title = $titleStr
                    ProcessId = $processId
                    ProcessName = $procName
                }) | Out-Null
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null

$windows | ConvertTo-Json
`;

  try {
    const output = await runPowerShellScript(psScript, 'get-windows.ps1');
    if (!output || !output.trim()) return [];
    const windows = JSON.parse(output);
    return Array.isArray(windows) ? windows : [windows];
  } catch (err) {
    console.error('Error getting windows:', err);
    return [];
  }
}

// Maximize and bring window to front
async function maximizeWindow(handle) {
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$handle = [IntPtr]${handle}
[Win32]::ShowWindow($handle, 3) | Out-Null
[Win32]::SetForegroundWindow($handle) | Out-Null
`;

  try {
    await runPowerShellScript(psScript, 'maximize-window.ps1');
    return true;
  } catch (err) {
    console.error('Error maximizing window:', err);
    return false;
  }
}

// Get window position and size
async function getWindowRect(handle) {
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowRect(IntPtr hWnd, ref RECT rect);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
$handle = [IntPtr]${handle}
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($handle, [ref]$rect) | Out-Null
@{
    x = $rect.Left
    y = $rect.Top
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
} | ConvertTo-Json
`;

  try {
    const output = await runPowerShellScript(psScript, 'get-window-rect.ps1');
    return JSON.parse(output);
  } catch (err) {
    console.error('Error getting window rect:', err);
    return null;
  }
}

module.exports = {
  getWindows,
  maximizeWindow,
  getWindowRect
};
