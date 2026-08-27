using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private const string AdminUrl = "http://localhost:3000/admin/";
    private static readonly object ConsoleLock = new object();

    private static int Main(string[] args)
    {
        bool selfTest = HasArgument(args, "--self-test");
        bool noBrowser = selfTest || HasArgument(args, "--no-browser");
        var processes = new List<Process>();
        JobObject job = null;

        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "Surviv.io 网页后台启动器";
        WriteHeader();

        try
        {
            string projectRoot = FindProjectRoot(AppDomain.CurrentDomain.BaseDirectory);
            string nodePath = FindNodeExecutable();
            ValidateNode(nodePath, projectRoot);
            ValidateDependencies(projectRoot);

            WriteStatus("项目目录", projectRoot, ConsoleColor.DarkGray);
            WriteStatus("Node.js", RunAndCapture(nodePath, "--version", projectRoot).Trim(), ConsoleColor.DarkGray);

            job = new JobObject();

            Process server = null;
            Process client = null;

            if (IsPortOpen("127.0.0.1", 8001, 250) || IsPortOpen("::1", 8001, 250))
            {
                throw new InvalidOperationException(
                    "端口 8001 已被占用。请关闭旧版 Surviv/Node 服务端后再启动 V45。");
            }
            server = StartNode(
                nodePath,
                "-r ts-node/register src/devServer.ts",
                Path.Combine(projectRoot, "server"),
                "服务端");
            processes.Add(server);
            job.AddProcess(server);

            // Do not expose Vite until the API is accepting connections. The
            // browser requests site_info and admin status immediately, which
            // otherwise produces misleading ECONNREFUSED errors during startup.
            WaitForDualStackPort(
                server,
                "服务端",
                8001,
                TimeSpan.FromSeconds(selfTest ? 20 : 90));

            if (IsPortOpen("127.0.0.1", 3000, 250) || IsPortOpen("::1", 3000, 250))
            {
                throw new InvalidOperationException(
                    "端口 3000 已被占用。请关闭旧版 Vite/Surviv 网页端后再启动 V45。");
            }
            string viteCache = Path.Combine(projectRoot, "client", "node_modules", ".vite");
            if (Directory.Exists(viteCache))
            {
                Directory.Delete(viteCache, true);
            }
            client = StartNode(
                nodePath,
                "node_modules/vite/bin/vite.js dev",
                Path.Combine(projectRoot, "client"),
                "网页端");
            processes.Add(client);
            job.AddProcess(client);

            WaitUntilReady(
                server,
                client,
                TimeSpan.FromSeconds(selfTest ? 20 : 90));

            WriteLine();
            WriteLine("  启动成功", ConsoleColor.Green);
            WriteLine("  网页后台: " + AdminUrl, ConsoleColor.Cyan);
            WriteIpv6AccessUrls();

            if (!noBrowser)
            {
                OpenBrowser(AdminUrl);
            }

            if (selfTest)
            {
                VerifyHttp("http://[::1]:3000/admin/");
                VerifyHttp("http://[::1]:8001/api/site_info");
                VerifyWebSocket("ws://[::1]:8001/ptc");
                WriteLine("  [OK] EXE 自检通过", ConsoleColor.Green);
                return 0;
            }

            WriteLine();
            WriteLine("  保持此窗口开启。按 Enter 停止本启动器创建的服务。", ConsoleColor.White);
            WaitForEnter();
            return 0;
        }
        catch (Exception ex)
        {
            WriteLine();
            WriteLine("  启动失败: " + ex.Message, ConsoleColor.Red);

            if (!selfTest)
            {
                WriteLine();
                WriteLine("  窗口会保留，请查看上方错误。按 Enter 关闭。", ConsoleColor.Yellow);
                WaitForEnter();
            }

            return 1;
        }
        finally
        {
            if (job != null)
            {
                job.Dispose();
            }

            foreach (Process process in processes)
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
        }
    }

    private static void WriteHeader()
    {
        WriteLine("============================================================", ConsoleColor.DarkCyan);
        WriteLine("  SURVIV.IO 网页后台启动器", ConsoleColor.Cyan);
        WriteLine("  仅启动服务，不包含原生管理界面", ConsoleColor.DarkGray);
        WriteLine("============================================================", ConsoleColor.DarkCyan);
        WriteLine();
    }

    private static bool HasArgument(string[] args, string expected)
    {
        foreach (string value in args)
        {
            if (string.Equals(value, expected, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static void WaitForEnter()
    {
        while (true)
        {
            try
            {
                if (Console.KeyAvailable && Console.ReadKey(true).Key == ConsoleKey.Enter)
                {
                    return;
                }
            }
            catch (InvalidOperationException)
            {
                // Some launch surfaces provide a console without a readable stdin.
                // Keep the launcher alive instead of treating that as an Enter press.
            }

            Thread.Sleep(150);
        }
    }

    private static void WriteIpv6AccessUrls()
    {
        var globalAddresses = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var linkLocalAddresses = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up ||
                adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                adapter.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            foreach (UnicastIPAddressInformation information in adapter.GetIPProperties().UnicastAddresses)
            {
                IPAddress address = information.Address;
                if (address.AddressFamily != AddressFamily.InterNetworkV6 ||
                    address.IsIPv6Multicast ||
                    IPAddress.IsLoopback(address))
                {
                    continue;
                }

                string value = address.ToString().Replace("%", "%25");
                if (address.IsIPv6LinkLocal)
                {
                    linkLocalAddresses.Add(value);
                }
                else
                {
                    globalAddresses.Add(value);
                }
            }
        }

        SortedSet<string> addresses = globalAddresses.Count > 0
            ? globalAddresses
            : linkLocalAddresses;
        if (addresses.Count == 0)
        {
            WriteStatus("IPv6 联机", "未发现可用的局域网 IPv6 地址", ConsoleColor.Yellow);
            return;
        }

        int displayed = 0;
        foreach (string address in addresses)
        {
            WriteStatus("IPv6 联机", "http://[" + address + "]:3000/", ConsoleColor.Cyan);
            if (++displayed >= 3) break;
        }
    }

    private static void VerifyHttp(string url)
    {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null;
        request.Timeout = 5000;
        request.ReadWriteTimeout = 5000;

        using (var response = (HttpWebResponse)request.GetResponse())
        {
            if (response.StatusCode != HttpStatusCode.OK)
            {
                throw new InvalidOperationException(
                    "IPv6 HTTP 自检失败: " + url + " 返回 " + (int)response.StatusCode + "。");
            }
        }
    }

    private static void VerifyWebSocket(string url)
    {
        using (var socket = new ClientWebSocket())
        {
            socket.Options.Proxy = null;
            try
            {
                var connect = socket.ConnectAsync(new Uri(url), CancellationToken.None);
                if (!connect.Wait(5000) || socket.State != WebSocketState.Open)
                {
                    socket.Abort();
                    throw new InvalidOperationException("连接超时");
                }
                socket.Abort();
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    "IPv6 WebSocket 自检失败: " + url + "（" + ex.GetBaseException().Message + "）");
            }
        }
    }

    private static string FindProjectRoot(string startPath)
    {
        DirectoryInfo current = new DirectoryInfo(startPath);

        for (int depth = 0; current != null && depth < 5; depth++, current = current.Parent)
        {
            if (File.Exists(Path.Combine(current.FullName, "server", "package.json")) &&
                File.Exists(Path.Combine(current.FullName, "client", "package.json")))
            {
                return current.FullName.TrimEnd(Path.DirectorySeparatorChar);
            }
        }

        throw new InvalidOperationException("启动器必须放在 surviv.io 项目目录内。");
    }

    private static string FindNodeExecutable()
    {
        var candidates = new List<string>();
        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;

        foreach (string item in pathValue.Split(Path.PathSeparator))
        {
            string directory = item.Trim().Trim('"');
            if (directory.Length > 0)
            {
                candidates.Add(Path.Combine(directory, "node.exe"));
            }
        }

        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (!string.IsNullOrEmpty(programFiles))
        {
            candidates.Add(Path.Combine(programFiles, "nodejs", "node.exe"));
        }

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrEmpty(localAppData))
        {
            candidates.Add(Path.Combine(localAppData, "Programs", "nodejs", "node.exe"));
        }

        foreach (string candidate in candidates)
        {
            try
            {
                if (File.Exists(candidate))
                {
                    return Path.GetFullPath(candidate);
                }
            }
            catch
            {
            }
        }

        throw new InvalidOperationException("未找到 Node.js。请先安装 Node.js 20 或更高版本。");
    }

    private static void ValidateNode(string nodePath, string projectRoot)
    {
        string version = RunAndCapture(nodePath, "--version", projectRoot).Trim().TrimStart('v', 'V');
        string[] parts = version.Split('.');
        int major;

        if (parts.Length == 0 || !int.TryParse(parts[0], out major) || major < 20)
        {
            throw new InvalidOperationException("需要 Node.js 20 或更高版本，当前版本为 " + version + "。");
        }
    }

    private static void ValidateDependencies(string projectRoot)
    {
        string serverDependency = Path.Combine(projectRoot, "server", "node_modules", "ts-node", "register", "index.js");
        string clientDependency = Path.Combine(projectRoot, "client", "node_modules", "vite", "bin", "vite.js");

        if (!File.Exists(serverDependency) || !File.Exists(clientDependency))
        {
            throw new InvalidOperationException("依赖未安装。请先在 server 和 client 目录各运行一次 npm install。");
        }
    }

    private static Process StartNode(string nodePath, string arguments, string workingDirectory, string label)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
        {
            if (eventArgs.Data != null)
            {
                WriteLog(label, eventArgs.Data, ConsoleColor.Gray);
            }
        };

        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
        {
            if (eventArgs.Data != null)
            {
                WriteLog(label, eventArgs.Data, ConsoleColor.DarkYellow);
            }
        };

        process.Exited += delegate
        {
            WriteLog(label, "进程已退出，退出代码 " + SafeExitCode(process), ConsoleColor.Red);
        };

        if (!process.Start())
        {
            throw new InvalidOperationException(label + "进程无法启动。");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        WriteStatus(label, "正在启动（PID " + process.Id + "）", ConsoleColor.Cyan);
        return process;
    }

    private static void WaitUntilReady(Process server, Process client, TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        bool apiIpv4Ready = false;
        bool apiIpv6Ready = false;
        bool webIpv4Ready = false;
        bool webIpv6Ready = false;

        while (DateTime.UtcNow < deadline)
        {
            if (server != null && server.HasExited)
            {
                throw new InvalidOperationException("服务端提前退出，代码 " + SafeExitCode(server) + "。");
            }

            if (client != null && client.HasExited)
            {
                throw new InvalidOperationException("网页端提前退出，代码 " + SafeExitCode(client) + "。");
            }

            apiIpv4Ready = IsPortOpen("127.0.0.1", 8001, 200);
            apiIpv6Ready = IsPortOpen("::1", 8001, 200);
            webIpv4Ready = IsPortOpen("127.0.0.1", 3000, 200);
            webIpv6Ready = IsPortOpen("::1", 3000, 200);

            if (apiIpv4Ready && apiIpv6Ready && webIpv4Ready && webIpv6Ready)
            {
                WriteStatus("服务端", "http://localhost:8001 已就绪", ConsoleColor.Green);
                WriteStatus("服务端 IPv6", "http://[::1]:8001 已就绪", ConsoleColor.Green);
                WriteStatus("网页端", "http://localhost:3000 已就绪", ConsoleColor.Green);
                WriteStatus("网页端 IPv6", "http://[::1]:3000 已就绪", ConsoleColor.Green);
                return;
            }

            Thread.Sleep(300);
        }

        throw new TimeoutException(
            "双栈端口等待超时。" +
            " API IPv4=" + apiIpv4Ready +
            ", API IPv6=" + apiIpv6Ready +
            ", Web IPv4=" + webIpv4Ready +
            ", Web IPv6=" + webIpv6Ready + "。");
    }

    private static void WaitForDualStackPort(
        Process process,
        string label,
        int port,
        TimeSpan timeout)
    {
        DateTime deadline = DateTime.UtcNow.Add(timeout);
        bool ipv4Ready = false;
        bool ipv6Ready = false;

        while (DateTime.UtcNow < deadline)
        {
            if (process != null && process.HasExited)
            {
                throw new InvalidOperationException(
                    label + "提前退出，代码 " + SafeExitCode(process) + "。");
            }

            ipv4Ready = IsPortOpen("127.0.0.1", port, 200);
            ipv6Ready = IsPortOpen("::1", port, 200);
            if (ipv4Ready && ipv6Ready)
            {
                return;
            }

            Thread.Sleep(300);
        }

        throw new TimeoutException(
            label + "端口 " + port + " 等待超时。" +
            " IPv4=" + ipv4Ready + ", IPv6=" + ipv6Ready + "。");
    }

    private static bool IsPortOpen(string host, int port, int timeoutMilliseconds)
    {
        AddressFamily family = host.IndexOf(':') >= 0
            ? AddressFamily.InterNetworkV6
            : AddressFamily.InterNetwork;
        using (var client = new TcpClient(family))
        {
            try
            {
                IAsyncResult result = client.BeginConnect(host, port, null, null);
                using (result.AsyncWaitHandle)
                {
                    if (!result.AsyncWaitHandle.WaitOne(timeoutMilliseconds))
                    {
                        return false;
                    }

                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }
    }

    private static string RunAndCapture(string fileName, string arguments, string workingDirectory)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            }
        };

        process.Start();
        string output = process.StandardOutput.ReadToEnd();
        string error = process.StandardError.ReadToEnd();

        if (!process.WaitForExit(10000))
        {
            process.Kill();
            throw new TimeoutException("检查 Node.js 版本超时。");
        }

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(error.Trim().Length > 0 ? error.Trim() : "Node.js 无法运行。");
        }

        process.Dispose();
        return output;
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            WriteStatus("浏览器", "已打开网页版后台", ConsoleColor.Green);
        }
        catch (Exception ex)
        {
            WriteStatus("浏览器", "自动打开失败，请手动访问地址（" + ex.Message + "）", ConsoleColor.Yellow);
        }
    }

    private static int SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode;
        }
        catch
        {
            return -1;
        }
    }

    private static void WriteStatus(string label, string message, ConsoleColor color)
    {
        WriteLine("  [" + label + "] " + message, color);
    }

    private static void WriteLog(string label, string message, ConsoleColor color)
    {
        WriteLine("  " + DateTime.Now.ToString("HH:mm:ss") + " [" + label + "] " + message, color);
    }

    private static void WriteLine(string message, ConsoleColor color)
    {
        lock (ConsoleLock)
        {
            ConsoleColor previous = Console.ForegroundColor;
            Console.ForegroundColor = color;
            Console.WriteLine(message);
            Console.ForegroundColor = previous;
        }
    }

    private static void WriteLine()
    {
        lock (ConsoleLock)
        {
            Console.WriteLine();
        }
    }
}

internal sealed class JobObject : IDisposable
{
    private const uint KillOnJobClose = 0x00002000;
    private IntPtr handle;

    public JobObject()
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero)
        {
            throw new InvalidOperationException("无法创建进程清理任务。");
        }

        var information = new JobObjectExtendedLimitInformation();
        information.BasicLimitInformation.LimitFlags = KillOnJobClose;
        int length = Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation));
        IntPtr pointer = Marshal.AllocHGlobal(length);

        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(handle, 9, pointer, (uint)length))
            {
                throw new InvalidOperationException("无法配置进程清理任务。");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    public void AddProcess(Process process)
    {
        if (!AssignProcessToJobObject(handle, process.Handle))
        {
            throw new InvalidOperationException("无法管理启动的进程 " + process.Id + "。");
        }
    }

    public void Dispose()
    {
        if (handle != IntPtr.Zero)
        {
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
