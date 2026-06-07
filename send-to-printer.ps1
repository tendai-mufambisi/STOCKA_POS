param(
  [string]$FilePath,
  [string]$PrinterName = "POS-58"
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr h, int level, [In] ref DOCINFO di);
    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);

    public static string Send(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            return "OpenPrinter failed: " + Marshal.GetLastWin32Error();
        var di = new DOCINFO { pDocName = "Receipt", pDataType = "RAW" };
        if (StartDocPrinter(hPrinter, 1, ref di) == 0) {
            ClosePrinter(hPrinter);
            return "StartDocPrinter failed: " + Marshal.GetLastWin32Error();
        }
        StartPagePrinter(hPrinter);
        int written;
        bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        if (!ok) return "WritePrinter failed: " + Marshal.GetLastWin32Error();
        if (written != bytes.Length) return "Partial write: " + written + " of " + bytes.Length;
        return "PRINT_OK";
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
$bytes  = [System.IO.File]::ReadAllBytes($FilePath)
$result = [RawPrint]::Send($PrinterName, $bytes)
Write-Host $result
if ($result -ne "PRINT_OK") { exit 1 }
