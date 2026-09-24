// PaperQuay Word 加载项安装器（单文件 WinForms，清单以嵌入资源随 exe 分发）。
//
// 它解决的是「让 Word 认识这个加载项」这三件本地设置，全部只动当前用户、不需要管理员权限：
//   1. 生成（或复用）localhost 自签证书，写入 %LOCALAPPDATA%\PaperQuay\OfficeAddin；
//   2. 写一份与源站端口一致的 manifest.xml（内嵌自 office-addin/manifest.xml）；
//   3. 在 HKCU\Software\Microsoft\Office\16.0\WEF\Developer 注册侧载清单；
//   4. 可选把证书导入「受信任的根证书颁发机构（当前用户）」，Word 便不再报证书错误。
//
// 加载项页面本身由 PaperQuay 本体托管（electron/backend/officeAddinHost.cjs：
// https://localhost:3000，证书不可用时回退 http://localhost:3007），因此本安装器不常驻任何进程；
// 运行时保持 PaperQuay 打开即可。
//
// 编译（见 scripts/Build-OfficeAddinInstaller.ps1，不需要 .NET SDK）：
//   csc /target:winexe /out:... /resource:office-addin\manifest.xml,PQAddin.manifest.xml ...

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PaperQuay.OfficeAddin
{
    internal static class SetupConstants
    {
        public const string AppTitle = "PaperQuay Word 加载项安装器";
        public const string InstallerVersion = "0.3.2";
        public const string DefaultHttpsOrigin = "https://localhost:3000";
        public const int DefaultHttpsPort = 3000;
        public const int DefaultHttpPort = 3007;
        public const string ManifestFileName = "manifest.xml";
        public const string PfxFileName = "paperquay-addin.pfx";
        public const string CerFileName = "paperquay-addin.cer";
        public const string PassphraseFileName = "passphrase.txt";
        public const string InstallInfoFileName = "install.json";
        public const string ManifestResourceName = "PQAddin.manifest.xml";
        public const string IconResourceName = "PQAddin.icon.png";
        public const string CertificateFriendlyName = "PaperQuay Office Add-in";
        /// <summary>Word（16.0 及以后）的开发者侧载键；写入这里等价于「我的加载项 → 共享文件夹」。</summary>
        public const string RegistryPath = @"Software\Microsoft\Office\16.0\WEF\Developer";
        public const string RegistryValueName = "PaperQuayOfficeAddin";
    }

    internal static class Paths
    {
        private static string LocalAppData
        {
            get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); }
        }

        public static string InstallDir
        {
            get { return Path.Combine(LocalAppData, "PaperQuay", "OfficeAddin"); }
        }

        public static string ManifestPath { get { return Path.Combine(InstallDir, SetupConstants.ManifestFileName); } }

        public static string PfxPath { get { return Path.Combine(InstallDir, SetupConstants.PfxFileName); } }

        public static string CerPath { get { return Path.Combine(InstallDir, SetupConstants.CerFileName); } }

        public static string PassphrasePath { get { return Path.Combine(InstallDir, SetupConstants.PassphraseFileName); } }

        public static string InstallInfoPath { get { return Path.Combine(InstallDir, SetupConstants.InstallInfoFileName); } }

        /// <summary>
        /// 桥发现文件：应用把 userData 定为 &lt;APPDATA&gt;\paperquay\PaperQuay（package.json 的 name 为 paperquay），
        /// 这里按新旧两种布局都找一遍（Windows 路径大小写不敏感，重复项无副作用）。
        /// </summary>
        public static IEnumerable<string> BridgeDiscoveryCandidates()
        {
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            yield return Path.Combine(roaming, "paperquay", "PaperQuay", "paperquay-office-bridge.json");
            yield return Path.Combine(roaming, "PaperQuay", "PaperQuay", "paperquay-office-bridge.json");
            yield return Path.Combine(roaming, "paperquay", "paperquay-office-bridge.json");
            yield return Path.Combine(roaming, "PaperQuay", "paperquay-office-bridge.json");
        }

        public static IEnumerable<string> AppExecutableCandidates()
        {
            string local = LocalAppData;
            yield return Path.Combine(local, "Programs", "PaperQuay", "PaperQuay.exe");
            yield return Path.Combine(local, "PaperQuay", "PaperQuay.exe");
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            yield return Path.Combine(programFiles, "PaperQuay", "PaperQuay.exe");
        }
    }

    internal sealed class SetupOptions
    {
        public bool Silent;
        public bool Uninstall;
        public bool Diagnose;
        public bool Help;
        public bool UseHttp;
        public bool Trust = true;
        public int HttpsPort = SetupConstants.DefaultHttpsPort;
        public int HttpPort = SetupConstants.DefaultHttpPort;

        public string Origin
        {
            get
            {
                return UseHttp
                    ? "http://localhost:" + HttpPort.ToString(CultureInfo.InvariantCulture)
                    : "https://localhost:" + HttpsPort.ToString(CultureInfo.InvariantCulture);
            }
        }

        public string Scheme { get { return UseHttp ? "http" : "https"; } }

        public int Port { get { return UseHttp ? HttpPort : HttpsPort; } }

        public static SetupOptions Parse(string[] args)
        {
            SetupOptions options = new SetupOptions();
            for (int index = 0; index < args.Length; index += 1)
            {
                string arg = args[index] == null ? string.Empty : args[index].Trim();
                switch (arg.ToLowerInvariant())
                {
                    case "--silent":
                    case "-s":
                        options.Silent = true;
                        break;
                    case "--uninstall":
                    case "-u":
                        options.Uninstall = true;
                        options.Silent = true;
                        break;
                    case "--diagnose":
                        options.Diagnose = true;
                        break;
                    case "--http":
                        options.UseHttp = true;
                        break;
                    case "--https":
                        options.UseHttp = false;
                        break;
                    case "--no-trust":
                        options.Trust = false;
                        break;
                    case "--trust":
                        options.Trust = true;
                        break;
                    case "--help":
                    case "-h":
                    case "/?":
                        options.Help = true;
                        break;
                    case "--https-port":
                        options.HttpsPort = ParsePort(Next(args, ref index), options.HttpsPort);
                        break;
                    case "--http-port":
                        options.HttpPort = ParsePort(Next(args, ref index), options.HttpPort);
                        break;
                    default:
                        throw new ArgumentException("无法识别的参数：" + arg);
                }
            }
            return options;
        }

        private static string Next(string[] args, ref int index)
        {
            index += 1;
            if (index >= args.Length) throw new ArgumentException("参数缺少取值");
            return args[index];
        }

        private static int ParsePort(string text, int fallback)
        {
            int port;
            if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out port)) return fallback;
            if (port <= 0 || port > 65535) return fallback;
            return port;
        }

        public static string Usage()
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine(SetupConstants.AppTitle + " " + SetupConstants.InstallerVersion);
            builder.AppendLine();
            builder.AppendLine("用法：");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe                     图形界面（默认安装）");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe --silent            静默安装");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe --silent --no-trust 静默安装且不信任证书");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe --silent --http     不用 HTTPS（源站回退 http://localhost:3007）");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe --diagnose          只做诊断，不改动任何设置");
            builder.AppendLine("  PaperQuay-OfficeAddin-Setup.exe --uninstall         卸载（移除侧载注册表与安装目录）");
            builder.AppendLine();
            builder.AppendLine("它只做这几件本地设置（都不需要管理员权限）：");
            builder.AppendLine("  1. 生成/复用 localhost 自签证书 → " + Paths.InstallDir);
            builder.AppendLine("  2. 写一份与该端口一致的 manifest.xml");
            builder.AppendLine("  3. 在 HKCU\\" + SetupConstants.RegistryPath + " 注册侧载清单");
            builder.AppendLine("  4. 可选：把证书导入「受信任的根证书颁发机构（当前用户）」");
            builder.AppendLine();
            builder.AppendLine("加载项页面由 PaperQuay 本体托管，运行时请保持 PaperQuay 打开。");
            return builder.ToString();
        }
    }

    internal sealed class ProcessResult
    {
        public int ExitCode;
        public string Output = string.Empty;
        public string Error = string.Empty;

        public bool Ok { get { return ExitCode == 0; } }

        public string Message
        {
            get
            {
                string text = string.IsNullOrEmpty(Error) ? Output : Error;
                return text == null ? string.Empty : text.Trim();
            }
        }
    }

    /// <summary>把 PowerShell 脚本写入临时 .ps1 再执行，避免路径空格与引号转义问题。</summary>
    internal static class PowerShellRunner
    {
        public static ProcessResult Run(string script)
        {
            ProcessResult result = new ProcessResult();
            string scriptPath = Path.Combine(Path.GetTempPath(), "paperquay-addin-" + Guid.NewGuid().ToString("N") + ".ps1");
            try
            {
                File.WriteAllText(scriptPath, script, new UTF8Encoding(true));
                ProcessStartInfo info = new ProcessStartInfo(
                    "powershell",
                    "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"");
                info.UseShellExecute = false;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.CreateNoWindow = true;
                using (Process process = Process.Start(info))
                {
                    result.Output = process.StandardOutput.ReadToEnd();
                    result.Error = process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    result.ExitCode = process.ExitCode;
                }
            }
            catch (Exception error)
            {
                result.ExitCode = -1;
                result.Error = error.Message;
            }
            finally
            {
                try
                {
                    if (File.Exists(scriptPath)) File.Delete(scriptPath);
                }
                catch
                {
                    // 临时文件删除失败不影响安装结果
                }
            }
            return result;
        }

        public static string Quote(string value)
        {
            return "'" + (value == null ? string.Empty : value.Replace("'", "''")) + "'";
        }
    }

    internal static class CertificateTools
    {
        public static string Base64Url(int byteCount)
        {
            byte[] buffer = new byte[byteCount];
            using (RandomNumberGenerator generator = new RNGCryptoServiceProvider())
            {
                generator.GetBytes(buffer);
            }
            string text = Convert.ToBase64String(buffer);
            return text.Replace("+", "-").Replace("/", "_").Replace("=", string.Empty);
        }

        public static bool Exists(string thumbprint)
        {
            return Find(thumbprint, StoreName.My) != null;
        }

        public static bool IsTrusted(string thumbprint)
        {
            return Find(thumbprint, StoreName.Root) != null;
        }

        private static X509Certificate2 Find(string thumbprint, StoreName storeName)
        {
            if (string.IsNullOrEmpty(thumbprint)) return null;
            try
            {
                X509Store store = new X509Store(storeName, StoreLocation.CurrentUser);
                store.Open(OpenFlags.ReadOnly);
                try
                {
                    X509Certificate2Collection found = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
                    return found.Count > 0 ? found[0] : null;
                }
                finally
                {
                    store.Close();
                }
            }
            catch
            {
                return null;
            }
        }

        /// <summary>生成自签证书并导出 pfx/cer；成功返回指纹，失败返回 null 并给出原因。</summary>
        public static string Generate(string passphrase, out string error)
        {
            error = string.Empty;
            string script = string.Join("; ", new string[]
            {
                "$ErrorActionPreference = 'Stop'",
                "$cert = New-SelfSignedCertificate -DnsName 'localhost', '127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName "
                    + PowerShellRunner.Quote(SetupConstants.CertificateFriendlyName) + " -NotAfter (Get-Date).AddYears(5) -KeyExportPolicy Exportable",
                "$password = ConvertTo-SecureString -String " + PowerShellRunner.Quote(passphrase) + " -Force -AsPlainText",
                "Export-PfxCertificate -Cert $cert -FilePath " + PowerShellRunner.Quote(Paths.PfxPath) + " -Password $password | Out-Null",
                "Export-Certificate -Cert $cert -FilePath " + PowerShellRunner.Quote(Paths.CerPath) + " | Out-Null",
                "Write-Output $cert.Thumbprint",
            });

            ProcessResult result = PowerShellRunner.Run(script);
            if (!result.Ok)
            {
                error = result.Message;
                return null;
            }
            Match match = Regex.Match(result.Output ?? string.Empty, "[0-9A-Fa-f]{40}");
            if (!match.Success)
            {
                error = "无法从证书生成结果中解析指纹：" + result.Message;
                return null;
            }
            return match.Value.ToUpperInvariant();
        }

        public static string ThumbprintOfCer(string cerPath)
        {
            try
            {
                X509Certificate2 certificate = new X509Certificate2(cerPath);
                return certificate.Thumbprint == null ? null : certificate.Thumbprint.ToUpperInvariant();
            }
            catch
            {
                return null;
            }
        }

        public static bool Trust(string cerPath, out string error)
        {
            error = string.Empty;
            // 必须让导入失败反映为退出码：不加 $ErrorActionPreference='Stop' 时，用户在系统安全提示里点「否」
            // 只会产生语句级错误，PowerShell 仍以 0 退出，会造成「提示已导入但实际没导入」。
            ProcessResult result = PowerShellRunner.Run(
                "$ErrorActionPreference = 'Stop'; "
                + "Import-Certificate -FilePath " + PowerShellRunner.Quote(cerPath) + " -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null");
            if (!result.Ok)
            {
                error = result.Message;
                return false;
            }
            // 退出码仍不完全可信：导入后回查存储区，以证书真的在受信任根里为准。
            string thumbprint = ThumbprintOfCer(cerPath);
            if (!string.IsNullOrEmpty(thumbprint) && IsTrusted(thumbprint)) return true;
            error = "导入命令执行后证书仍未出现在「受信任的根证书颁发机构」（可能取消了系统安全提示）。";
            return false;
        }

        public static bool Untrust(string thumbprint, out string error)
        {
            error = string.Empty;
            X509Certificate2 certificate = Find(thumbprint, StoreName.Root);
            if (certificate == null) return true;
            try
            {
                X509Store store = new X509Store(StoreName.Root, StoreLocation.CurrentUser);
                store.Open(OpenFlags.ReadWrite);
                try
                {
                    store.Remove(certificate);
                }
                finally
                {
                    store.Close();
                }
                return true;
            }
            catch (Exception caught)
            {
                error = caught.Message;
                return false;
            }
        }
    }

    internal static class Json
    {
        public static string Escape(string value)
        {
            if (value == null) return string.Empty;
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        public static string GetString(string text, string key)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            Match match = Regex.Match(text, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            if (!match.Success) return string.Empty;
            return match.Groups[1].Value.Replace("\\\\", "\\").Replace("\\\"", "\"");
        }

        public static int GetInt(string text, string key, int fallback)
        {
            if (string.IsNullOrEmpty(text)) return fallback;
            Match match = Regex.Match(text, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(\\d+)");
            int value;
            if (!match.Success || !int.TryParse(match.Groups[1].Value, out value)) return fallback;
            return value;
        }

        public static bool GetBool(string text, string key)
        {
            if (string.IsNullOrEmpty(text)) return false;
            Match match = Regex.Match(text, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)");
            return match.Success && match.Groups[1].Value == "true";
        }
    }

    /// <summary>安装器与 PaperQuay 本体共用的状态文件（本体只读它，用于设置页显示「已侧载」）。</summary>
    internal sealed class InstallInfo
    {
        public string Origin = string.Empty;
        public string Scheme = string.Empty;
        public int Port;
        public string ManifestPath = string.Empty;
        public string CertThumbprint = string.Empty;
        public string InstalledAt = string.Empty;
        public string Version = SetupConstants.InstallerVersion;
        public bool Trusted;

        public static InstallInfo Load(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                string text = File.ReadAllText(path, Encoding.UTF8);
                InstallInfo info = new InstallInfo();
                info.Origin = Json.GetString(text, "origin");
                info.Scheme = Json.GetString(text, "scheme");
                info.Port = Json.GetInt(text, "port", SetupConstants.DefaultHttpsPort);
                info.ManifestPath = Json.GetString(text, "manifestPath");
                info.CertThumbprint = Json.GetString(text, "certThumbprint");
                info.InstalledAt = Json.GetString(text, "installedAt");
                info.Version = Json.GetString(text, "version");
                info.Trusted = Json.GetBool(text, "trusted");
                return info;
            }
            catch
            {
                return null;
            }
        }

        public string ToJson()
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine("{");
            builder.AppendLine("  \"origin\": \"" + Json.Escape(Origin) + "\",");
            builder.AppendLine("  \"scheme\": \"" + Json.Escape(Scheme) + "\",");
            builder.AppendLine("  \"port\": " + Port.ToString(CultureInfo.InvariantCulture) + ",");
            builder.AppendLine("  \"manifestPath\": \"" + Json.Escape(ManifestPath) + "\",");
            builder.AppendLine("  \"certThumbprint\": \"" + Json.Escape(CertThumbprint) + "\",");
            builder.AppendLine("  \"installedAt\": \"" + Json.Escape(InstalledAt) + "\",");
            builder.AppendLine("  \"version\": \"" + Json.Escape(Version) + "\",");
            builder.AppendLine("  \"trusted\": " + (Trusted ? "true" : "false"));
            builder.AppendLine("}");
            return builder.ToString();
        }
    }

    internal static class ResourceFiles
    {
        public static string ReadText(string name)
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (stream == null) return null;
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
        }

        public static Icon LoadIcon(string name)
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
                {
                    if (stream == null) return null;
                    using (Bitmap bitmap = new Bitmap(stream))
                    {
                        IntPtr handle = bitmap.GetHicon();
                        return Icon.FromHandle(handle);
                    }
                }
            }
            catch
            {
                return null;
            }
        }
    }

    internal static class Installer
    {
        public static void Install(SetupOptions options, Action<string> log)
        {
            Directory.CreateDirectory(Paths.InstallDir);
            log("安装目录：" + Paths.InstallDir);

            InstallInfo previous = InstallInfo.Load(Paths.InstallInfoPath);
            bool useHttp = options.UseHttp;
            string thumbprint = previous == null ? string.Empty : previous.CertThumbprint;
            string passphrase = string.Empty;

            if (useHttp)
            {
                log("按参数要求使用 HTTP 源站，跳过证书步骤。");
            }
            else if (!string.IsNullOrEmpty(thumbprint)
                && CertificateTools.Exists(thumbprint)
                && File.Exists(Paths.PfxPath)
                && File.Exists(Paths.CerPath)
                && File.Exists(Paths.PassphrasePath))
            {
                log("复用已有证书（指纹 " + Shorten(thumbprint) + "）。");
                passphrase = File.ReadAllText(Paths.PassphrasePath, Encoding.UTF8).Trim();
            }
            else
            {
                // 口令文件与 pfx 同目录：都只放在当前用户 profile 下（%LOCALAPPDATA%），不额外放宽 ACL。
                passphrase = CertificateTools.Base64Url(18);
                File.WriteAllText(Paths.PassphrasePath, passphrase, new UTF8Encoding(false));
                string error;
                string generated = CertificateTools.Generate(passphrase, out error);
                if (generated == null)
                {
                    log("生成证书失败：" + error);
                    log("改为使用 HTTP 回退源站（http://localhost:" + options.HttpPort + "）：Word 会提示内容不安全，但功能可用。");
                    useHttp = true;
                    thumbprint = string.Empty;
                }
                else
                {
                    thumbprint = generated;
                    log("已生成自签证书（指纹 " + Shorten(thumbprint) + "）。");
                }
            }

            string origin = useHttp
                ? "http://localhost:" + options.HttpPort.ToString(CultureInfo.InvariantCulture)
                : "https://localhost:" + options.HttpsPort.ToString(CultureInfo.InvariantCulture);

            string manifest = ResourceFiles.ReadText(SetupConstants.ManifestResourceName);
            if (manifest == null)
            {
                throw new InvalidOperationException("exe 内没有找到清单资源，安装包不完整。");
            }
            manifest = manifest.Replace(SetupConstants.DefaultHttpsOrigin, origin);
            File.WriteAllText(Paths.ManifestPath, manifest, new UTF8Encoding(false));
            log("清单已写入：" + Paths.ManifestPath + "（源站 " + origin + "）");

            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(SetupConstants.RegistryPath))
            {
                if (key == null) throw new InvalidOperationException("无法创建侧载注册表键：" + SetupConstants.RegistryPath);
                key.SetValue(SetupConstants.RegistryValueName, Paths.ManifestPath, RegistryValueKind.String);
            }
            log("已注册侧载清单：HKCU\\" + SetupConstants.RegistryPath + "\\" + SetupConstants.RegistryValueName);

            bool trusted = false;
            if (!useHttp && options.Trust && !string.IsNullOrEmpty(thumbprint))
            {
                if (CertificateTools.IsTrusted(thumbprint))
                {
                    trusted = true;
                    log("证书已在「受信任的根证书颁发机构（当前用户）」中。");
                }
                else
                {
                    string error;
                    trusted = CertificateTools.Trust(Paths.CerPath, out error);
                    if (trusted)
                    {
                        log("证书已导入「受信任的根证书颁发机构（当前用户）」。");
                    }
                    else
                    {
                        log("导入受信任根证书失败：" + error + "（可忽略，但 Word 可能提示证书错误）");
                    }
                }
            }

            InstallInfo info = new InstallInfo();
            info.Origin = origin;
            info.Scheme = useHttp ? "http" : "https";
            info.Port = useHttp ? options.HttpPort : options.HttpsPort;
            info.ManifestPath = Paths.ManifestPath;
            info.CertThumbprint = thumbprint;
            info.InstalledAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
            info.Version = SetupConstants.InstallerVersion;
            info.Trusted = trusted;
            File.WriteAllText(Paths.InstallInfoPath, info.ToJson(), new UTF8Encoding(false));

            log(string.Empty);
            Diagnostics.Report(options, log, true);
            log(string.Empty);
            log("下一步：保持 PaperQuay 运行（它负责托管加载项页面），重启 Word 后");
            log("在「开始」选项卡里应能看到 PaperQuay 分组与「插入引用」按钮。");
        }

        private static string Shorten(string thumbprint)
        {
            if (string.IsNullOrEmpty(thumbprint)) return string.Empty;
            return thumbprint.Length > 8 ? thumbprint.Substring(0, 8) + "…" : thumbprint;
        }
    }

    internal static class Uninstaller
    {
        public static void Run(SetupOptions options, Action<string> log)
        {
            InstallInfo info = InstallInfo.Load(Paths.InstallInfoPath);

            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(SetupConstants.RegistryPath, true))
            {
                if (key != null)
                {
                    // 只删自己那一条，绝不删整个 Developer 键（其他加载项也在里面）。
                    key.DeleteValue(SetupConstants.RegistryValueName, false);
                }
            }
            log("已移除侧载注册表值。");

            if (info != null && !string.IsNullOrEmpty(info.CertThumbprint))
            {
                string error;
                if (CertificateTools.Untrust(info.CertThumbprint, out error))
                {
                    log("已从受信任根中移除证书（若曾导入）。");
                }
                else
                {
                    log("移除受信任根证书失败：" + error + "（可手动在 certmgr.msc 里删除）");
                }
            }

            try
            {
                if (Directory.Exists(Paths.InstallDir)) Directory.Delete(Paths.InstallDir, true);
                log("已删除安装目录：" + Paths.InstallDir);
            }
            catch (Exception error)
            {
                log("删除安装目录失败（可能被占用）：" + error.Message);
            }

            log(string.Empty);
            log("卸载完成。Word 里的加载项按钮可能要到下次重启 Word 才消失。");
            log("PaperQuay 本体未做任何改动。");
        }
    }

    internal sealed class CheckResult
    {
        public bool Ok;
        public string Text = string.Empty;

        public CheckResult(bool ok, string text)
        {
            Ok = ok;
            Text = text;
        }

        public override string ToString()
        {
            return (Ok ? "[ok]   " : "[warn] ") + Text;
        }
    }

    internal static class HttpProbe
    {
        public static string Get(string url, out int status, out string error)
        {
            status = 0;
            error = string.Empty;
            try
            {
                ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 3000;
                request.UserAgent = "PaperQuay-OfficeAddin-Installer";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    status = (int)response.StatusCode;
                    using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch (WebException caught)
            {
                HttpWebResponse response = caught.Response as HttpWebResponse;
                status = response == null ? 0 : (int)response.StatusCode;
                error = caught.Message;
                return null;
            }
            catch (Exception caught)
            {
                error = caught.Message;
                return null;
            }
        }
    }

    internal static class Diagnostics
    {
        public static List<CheckResult> Collect(SetupOptions options)
        {
            List<CheckResult> checks = new List<CheckResult>();

            InstallInfo info = InstallInfo.Load(Paths.InstallInfoPath);
            checks.Add(new CheckResult(
                info != null,
                info == null
                    ? "未找到 install.json（未用本安装器安装过）：" + Paths.InstallInfoPath
                    : "install.json 存在，记录源站 " + info.Origin + "（" + info.InstalledAt + "）"));

            bool manifestExists = File.Exists(Paths.ManifestPath);
            checks.Add(new CheckResult(manifestExists, manifestExists ? "清单存在：" + Paths.ManifestPath : "清单缺失：" + Paths.ManifestPath));

            string expectedOrigin = info == null ? options.Origin : info.Origin;
            if (manifestExists && !string.IsNullOrEmpty(expectedOrigin))
            {
                try
                {
                    string text = File.ReadAllText(Paths.ManifestPath, Encoding.UTF8);
                    checks.Add(new CheckResult(
                        text.IndexOf(expectedOrigin, StringComparison.OrdinalIgnoreCase) >= 0,
                        "清单里的源站地址与记录一致（" + expectedOrigin + "）"));
                }
                catch (Exception error)
                {
                    checks.Add(new CheckResult(false, "读取清单失败：" + error.Message));
                }
            }

            string registered = null;
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(SetupConstants.RegistryPath, false))
                {
                    registered = key == null ? null : key.GetValue(SetupConstants.RegistryValueName) as string;
                }
            }
            catch (Exception error)
            {
                checks.Add(new CheckResult(false, "读取侧载注册表失败：" + error.Message));
            }
            checks.Add(new CheckResult(
                !string.IsNullOrEmpty(registered) && File.Exists(registered),
                registered == null
                    ? "侧载注册表未登记（Word 不会加载该加载项）"
                    : (File.Exists(registered) ? "侧载清单已登记：" + registered : "侧载登记指向不存在的清单：" + registered)));

            if (info != null && !string.IsNullOrEmpty(info.CertThumbprint) && info.Scheme != "http")
            {
                checks.Add(new CheckResult(
                    CertificateTools.IsTrusted(info.CertThumbprint),
                    CertificateTools.IsTrusted(info.CertThumbprint)
                        ? "证书已在受信任根中（指纹 " + info.CertThumbprint.Substring(0, 8) + "…）"
                        : "证书未受信任：Word 会报证书错误，可在安装器里勾选信任或点设置页「信任本地证书」"));
            }

            if (!string.IsNullOrEmpty(expectedOrigin))
            {
                int status;
                string error;
                string body = HttpProbe.Get(expectedOrigin + "/taskpane.html", out status, out error);
                bool ok = status == 200 && body != null;
                checks.Add(new CheckResult(
                    ok,
                    ok
                        ? "加载项页面可达：" + expectedOrigin + "/taskpane.html"
                        : "加载项页面不可达（" + (status == 0 ? error : "HTTP " + status) + "）：请先启动 PaperQuay（源站随应用启动）"));
            }

            checks.Add(BridgeCheck());
            checks.Add(AppCheck());
            return checks;
        }

        private static CheckResult BridgeCheck()
        {
            foreach (string candidate in Paths.BridgeDiscoveryCandidates())
            {
                try
                {
                    if (!File.Exists(candidate)) continue;
                    string text = File.ReadAllText(candidate, Encoding.UTF8);
                    int port = Json.GetInt(text, "port", 0);
                    if (port <= 0) continue;
                    int status;
                    string error;
                    string body = HttpProbe.Get("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/health", out status, out error);
                    if (status == 200)
                    {
                        return new CheckResult(
                            true,
                            "Office 桥运行中：127.0.0.1:" + port + "（" + Json.GetString(body, "appVersion") + "，apiVersion "
                            + Json.GetInt(body, "apiVersion", 0).ToString(CultureInfo.InvariantCulture) + "）");
                    }
                    return new CheckResult(false, "发现文件存在但桥不可达（" + (status == 0 ? error : "HTTP " + status) + "）：" + candidate);
                }
                catch (Exception error)
                {
                    return new CheckResult(false, "读取桥发现文件失败：" + error.Message);
                }
            }
            return new CheckResult(false, "没有找到桥发现文件：先在 PaperQuay 设置里启动 Office 桥");
        }

        private static CheckResult AppCheck()
        {
            foreach (string candidate in Paths.AppExecutableCandidates())
            {
                if (File.Exists(candidate)) return new CheckResult(true, "PaperQuay 本体：" + candidate);
            }
            return new CheckResult(false, "未在常见位置找到 PaperQuay.exe（若已安装可忽略；源站需要它运行）");
        }

        public static bool Report(SetupOptions options, Action<string> log, bool quietWhenOk)
        {
            List<CheckResult> checks = Collect(options);
            bool allOk = true;
            foreach (CheckResult check in checks)
            {
                if (!check.Ok) allOk = false;
                if (!quietWhenOk || true) log(check.ToString());
            }
            return allOk;
        }

        public static bool Report(SetupOptions options, Action<string> log)
        {
            return Report(options, log, false);
        }
    }

    internal static class NativeConsole
    {
        private const uint AttachParentProcess = 0xFFFFFFFF;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FreeConsole();

        /// <summary>--silent / --diagnose 从终端调用时把输出接回父进程控制台。</summary>
        public static bool Attach()
        {
            if (!AttachConsole(AttachParentProcess)) return false;
            try
            {
                StreamWriter output = new StreamWriter(Console.OpenStandardOutput());
                output.AutoFlush = true;
                Console.SetOut(output);
                StreamWriter error = new StreamWriter(Console.OpenStandardError());
                error.AutoFlush = true;
                Console.SetError(error);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static void Detach()
        {
            try
            {
                FreeConsole();
            }
            catch
            {
                // 分离控制台失败无需处理
            }
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly SetupOptions options;
        private readonly CheckBox trustBox;
        private readonly CheckBox httpBox;
        private readonly TextBox logBox;
        private readonly List<Button> buttons = new List<Button>();

        public InstallerForm(SetupOptions options)
        {
            this.options = options;

            Text = SetupConstants.AppTitle;
            Font = new Font("Microsoft YaHei UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(640, 470);
            Icon icon = ResourceFiles.LoadIcon(SetupConstants.IconResourceName);
            if (icon != null) Icon = icon;

            Label title = new Label();
            title.Text = "把 PaperQuay 加载项装进 Word";
            title.Font = new Font(Font, FontStyle.Bold);
            title.SetBounds(14, 12, 610, 22);
            Controls.Add(title);

            Label hint = new Label();
            hint.Text = "只需一次：写侧载注册表 + 本地证书 + 清单。不需要管理员权限，加载项页面由 PaperQuay 本体托管。";
            hint.ForeColor = Color.DimGray;
            hint.SetBounds(14, 36, 610, 20);
            Controls.Add(hint);

            httpBox = new CheckBox();
            httpBox.Text = "不用 HTTPS（改用 http://localhost:3007，不装证书；Word 会提示内容不安全）";
            httpBox.SetBounds(14, 66, 610, 22);
            httpBox.Checked = options.UseHttp;
            httpBox.CheckedChanged += delegate
            {
                trustBox.Enabled = !httpBox.Checked;
            };
            Controls.Add(httpBox);

            trustBox = new CheckBox();
            trustBox.Text = "把本地自签证书加入「受信任的根证书颁发机构（当前用户）」（推荐，Word 不再报证书错误）";
            trustBox.SetBounds(14, 90, 610, 22);
            trustBox.Checked = options.Trust;
            Controls.Add(trustBox);

            AddButton("安装加载项", 14, 120, OnInstall);
            AddButton("卸载", 128, 120, OnUninstall);
            AddButton("诊断", 242, 120, OnDiagnose);
            AddButton("关闭", 356, 120, delegate { Close(); });

            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.SetBounds(14, 158, 612, 296);
            logBox.BackColor = Color.White;
            logBox.Font = new Font("Consolas", 8.5F);
            Controls.Add(logBox);

            Append("PaperQuay Word 加载项安装器 " + SetupConstants.InstallerVersion);
            Append("安装目录：" + Paths.InstallDir);
        }

        private void AddButton(string text, int left, int top, EventHandler handler)
        {
            Button button = new Button();
            button.Text = text;
            button.SetBounds(left, top, 108, 30);
            button.Click += handler;
            Controls.Add(button);
            buttons.Add(button);
        }

        private void Append(string line)
        {
            logBox.AppendText((line ?? string.Empty) + Environment.NewLine);
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
            Application.DoEvents();
        }

        private void RunBusy(Action action)
        {
            foreach (Button button in buttons) button.Enabled = false;
            Cursor previous = Cursor;
            Cursor = Cursors.WaitCursor;
            try
            {
                action();
            }
            finally
            {
                Cursor = previous;
                foreach (Button button in buttons) button.Enabled = true;
            }
        }

        private void OnInstall(object sender, EventArgs e)
        {
            RunBusy(delegate
            {
                options.UseHttp = httpBox.Checked;
                options.Trust = !httpBox.Checked && trustBox.Checked;
                Append(string.Empty);
                try
                {
                    Installer.Install(options, Append);
                }
                catch (Exception error)
                {
                    Append("安装失败：" + error.Message);
                }
            });
        }

        private void OnUninstall(object sender, EventArgs e)
        {
            DialogResult answer = MessageBox.Show(
                this,
                "确定要卸载 Word 加载项吗？\n会移除侧载注册表、受信任证书与本安装器的目录；PaperQuay 本体不受影响。",
                SetupConstants.AppTitle,
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Warning);
            if (answer != DialogResult.OK) return;

            RunBusy(delegate
            {
                Append(string.Empty);
                try
                {
                    Uninstaller.Run(options, Append);
                }
                catch (Exception error)
                {
                    Append("卸载失败：" + error.Message);
                }
            });
        }

        private void OnDiagnose(object sender, EventArgs e)
        {
            RunBusy(delegate
            {
                Append(string.Empty);
                Append("—— 诊断 ——");
                try
                {
                    Diagnostics.Report(options, Append);
                }
                catch (Exception error)
                {
                    Append("诊断失败：" + error.Message);
                }
            });
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            SetupOptions options;
            try
            {
                options = SetupOptions.Parse(args);
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                Console.Error.WriteLine(SetupOptions.Usage());
                return 2;
            }

            if (options.Help || options.Silent || options.Diagnose)
            {
                NativeConsole.Attach();
                try
                {
                    if (options.Help)
                    {
                        Console.WriteLine(SetupOptions.Usage());
                        return 0;
                    }
                    if (options.Diagnose)
                    {
                        return Diagnostics.Report(options, Console.WriteLine) ? 0 : 1;
                    }
                    if (options.Uninstall)
                    {
                        Uninstaller.Run(options, Console.WriteLine);
                        return 0;
                    }
                    Installer.Install(options, Console.WriteLine);
                    return 0;
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine("失败：" + error.Message);
                    return 1;
                }
                finally
                {
                    NativeConsole.Detach();
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm(options));
            return 0;
        }
    }
}
