using System;
using System.IO;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
class ShellProbe {
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    static void Main(string[] args) {
        var pid = Process.GetCurrentProcess().Id;
        var entry = new ManagementObject("win32_process.handle='" + pid + "'");
        var parent = Process.GetProcessById(Convert.ToInt32(entry["ParentProcessId"]));
        File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "probe.txt"), new string[] {
            parent.ProcessName, GetConsoleWindow().ToInt64().ToString(), String.Join("|", args)
        });
    }
}
