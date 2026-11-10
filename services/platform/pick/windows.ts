import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { isCancelError, pickedPaths } from './shared'
import type { PickKind, PickPathCapability, PickResult } from './types'

const execFileAsync = promisify(execFile)

function multiFolderScript(title: string): string {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ChayaFolderPicker {
  [Flags] enum FOS : uint { PICKFOLDERS = 0x20, FORCEFILESYSTEM = 0x40, ALLOWMULTISELECT = 0x200 }
  const uint SIGDN_FILESYSPATH = 0x80058000;
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem { void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv); void GetParent(out IShellItem ppsi); void GetDisplayName(uint sigdnName, out IntPtr ppszName); void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs); void Compare(IShellItem psi, uint hint, out int piOrder); }
  [ComImport, Guid("b63ea76d-1f85-456f-a19c-48159efa858b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemArray { void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv); void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv); void GetPropertyDescriptionList(ref Guid key, ref Guid riid, out IntPtr ppv); void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs); void GetCount(out uint pdwNumItems); void GetItemAt(uint dwIndex, out IShellItem ppsi); void EnumItems(out IntPtr ppenumShellItems); }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent); void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec); void SetFileTypeIndex(uint iFileType); void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie); void Unadvise(uint dwCookie); void SetOptions(FOS fos); void GetOptions(out FOS fos);
    void SetDefaultFolder(IShellItem psi); void SetFolder(IShellItem psi); void GetFolder(out IShellItem ppsi); void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText); void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi); void AddPlace(IShellItem psi, int fdap); void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr); void SetClientGuid(ref Guid guid); void ClearClientData(); void SetFilter(IntPtr pFilter);
  }
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent); void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec); void SetFileTypeIndex(uint iFileType); void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie); void Unadvise(uint dwCookie); void SetOptions(FOS fos); void GetOptions(out FOS fos);
    void SetDefaultFolder(IShellItem psi); void SetFolder(IShellItem psi); void GetFolder(out IShellItem ppsi); void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText); void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi); void AddPlace(IShellItem psi, int fdap); void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr); void SetClientGuid(ref Guid guid); void ClearClientData(); void SetFilter(IntPtr pFilter);
    void GetResults(out IShellItemArray ppenum); void GetSelectedItems(out IShellItemArray ppsai);
  }
  public static string[] Show(string title) {
    var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
    dialog.SetOptions(FOS.PICKFOLDERS | FOS.FORCEFILESYSTEM | FOS.ALLOWMULTISELECT);
    dialog.SetTitle(title);
    int hr = dialog.Show(IntPtr.Zero);
    if (hr == unchecked((int)0x800704C7)) return new string[0];
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    IShellItemArray items; dialog.GetResults(out items);
    uint count; items.GetCount(out count);
    var paths = new string[count];
    for (uint i = 0; i < count; i++) {
      IShellItem item; items.GetItemAt(i, out item);
      IntPtr name; item.GetDisplayName(SIGDN_FILESYSPATH, out name);
      paths[i] = Marshal.PtrToStringUni(name);
      Marshal.FreeCoTaskMem(name);
    }
    return paths;
  }
}
"@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$paths = [ChayaFolderPicker]::Show(${title})
if (-not $paths -or $paths.Length -eq 0) { exit 2 }
[Console]::Out.Write(($paths -join [Environment]::NewLine))
`.trim()
}

async function runPowerShell(ps: string): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  return String(stdout || '')
}

export class WindowsPickPath implements PickPathCapability {
  readonly id = 'pickPath' as const

  defaultPrompt(kind: PickKind): string {
    if (kind === 'app') return '选择干净的 NW.js（nw.exe）作为壳源'
    if (kind === 'game') return '选择 RPG Maker 游戏目录，可一次多选（含 www、内容根，或已打包的 .app / 发布目录）'
    return '选择 RPG Maker 游戏目录（含 www、内容根，或已打包的 .app / 发布目录）'
  }

  async pick(kind: PickKind, prompt?: string): Promise<PickResult> {
    const label = prompt || this.defaultPrompt(kind)
    const title = JSON.stringify(label)
    // 游戏只选目录；已打包旁挂 Game.exe 由 resolveGame 识别。禁止先弹「文件夹 / Game.exe」。
    const ps =
      kind === 'game'
        ? multiFolderScript(title)
        : kind === 'app'
          ? `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ${title}
$d.Filter = 'NW.js (nw.exe)|nw.exe|Executable (*.exe)|*.exe|All files (*.*)|*.*'
$d.FileName = 'nw.exe'
$d.CheckFileExists = $true
if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($d.FileName)
`.trim()
          : `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = ${title}
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($d.SelectedPath)
`.trim()

    try {
      const selected = pickedPaths(await runPowerShell(ps))
      if (!selected) return { ok: false, cancelled: true }
      return { ok: true, ...selected }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code = typeof err === 'object' && err && 'code' in err ? Number((err as { code?: number }).code) : NaN
      if (code === 2 || isCancelError(msg)) return { ok: false, cancelled: true }
      return { ok: false, error: msg }
    }
  }
}
