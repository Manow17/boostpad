# Merge tester helper: keyboard, mouse and screenshots for the game window.
# Reads one command per line on stdin and answers one line per command:
#   focus                       bring Rocket League to the front        -> ok | fail
#   down <key> / up <key>       hold or release a key (W, A, S, D, Space, LeftShift, Enter, Escape, Backspace)
#   tap <key> <ms>              press a key for <ms>
#   mouse <dx> <dy>             move the mouse (the game turns the camera)
#   shot <file.jpg> <width>     screenshot of the game window, scaled to <width>, saved as JPEG -> dark ratio
#   sheet <out.jpg> <cols> <files...>   paste images into one contact sheet (labels from file names)
#   quit
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class RL {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MOUSEINPUT mi; [FieldOffset(8)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static void Key(ushort vk, bool down, bool extended) {
    var i = new INPUT[1]; i[0].type = 1;
    i[0].ki.wScan = (ushort)MapVirtualKey(vk, 0);
    i[0].ki.dwFlags = 0x0008u | (down ? 0u : 0x0002u) | (extended ? 0x0001u : 0u); // scancode, keyup, extended
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Mouse(int dx, int dy) {
    var i = new INPUT[1]; i[0].type = 0; i[0].mi.dx = dx; i[0].mi.dy = dy; i[0].mi.dwFlags = 0x0001; // relative move
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static bool Focus(IntPtr h) {
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // an Alt tap lets a background process take focus
    ShowWindow(h, 9); return SetForegroundWindow(h);
  }
  // screenshot of a window, scaled; returns the share of very dark pixels (holes, black sky)
  public static double Shot(IntPtr h, string file, int width) {
    RECT r; GetWindowRect(h, out r);
    int w = r.R - r.L, ht = r.B - r.T;
    using (var full = new Bitmap(w, ht, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(r.L, r.T, 0, 0, new Size(w, ht));
      int ow = Math.Min(width, w), oh = (int)Math.Round((double)ht * ow / w);
      using (var small = new Bitmap(full, new Size(ow, oh))) {
        var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
        var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(Encoder.Quality, 82L);
        small.Save(file, enc, ps);
        int dark = 0, n = 0;
        for (int y = 0; y < oh; y += 4) for (int x = 0; x < ow; x += 4) { var c = small.GetPixel(x, y); n++; if (c.R + c.G + c.B < 36) dark++; }
        return (double)dark / n;
      }
    }
  }
  public static void Sheet(string outFile, int cols, string[] files) {
    int cw = 640, ch = 360, rows = (files.Length + cols - 1) / cols;
    using (var sheet = new Bitmap(cw * cols, ch * rows, PixelFormat.Format24bppRgb))
    using (var g = Graphics.FromImage(sheet))
    using (var font = new Font("Segoe UI", 14, FontStyle.Bold)) {
      g.Clear(Color.Black);
      for (int i = 0; i < files.Length; i++) {
        using (var img = Image.FromFile(files[i])) g.DrawImage(img, (i % cols) * cw, (i / cols) * ch, cw, ch);
        var label = System.IO.Path.GetFileNameWithoutExtension(files[i]);
        label = label.Substring(label.LastIndexOf('_') + 1);
        g.FillRectangle(new SolidBrush(Color.FromArgb(170, 0, 0, 0)), (i % cols) * cw, (i / cols) * ch, 12 + label.Length * 11, 30);
        g.DrawString(label, font, Brushes.White, (i % cols) * cw + 6, (i / cols) * ch + 3);
      }
      var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
      var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(Encoder.Quality, 80L);
      sheet.Save(outFile, enc, ps);
    }
  }
}
"@
$keys = @{ W = 0x57; A = 0x41; S = 0x53; D = 0x44; Space = 0x20; LeftShift = 0xA0; Enter = 0x0D; Escape = 0x1B; Backspace = 0x08; LeftControl = 0xA2 }
function Get-Game { Get-Process RocketLeague -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim() -split ' +'
  try {
    switch ($p[0]) {
      'focus' { $g = Get-Game; if ($g) { [void][RL]::Focus($g.MainWindowHandle); Start-Sleep -Milliseconds 300; $ok = [RL]::GetForegroundWindow() -eq $g.MainWindowHandle; $out = $(if ($ok) { 'ok' } else { 'fail' }) } else { $out = 'fail' } }
      'down' { [RL]::Key($keys[$p[1]], $true, $p[1] -eq 'LeftControl'); $out = 'ok' }
      'up' { [RL]::Key($keys[$p[1]], $false, $p[1] -eq 'LeftControl'); $out = 'ok' }
      'tap' { [RL]::Key($keys[$p[1]], $true, $false); Start-Sleep -Milliseconds ([int]$p[2]); [RL]::Key($keys[$p[1]], $false, $false); $out = 'ok' }
      'mouse' { # in small steps, so the game sees a smooth turn
        $dx = [int]$p[1]; $dy = [int]$p[2]; $n = 20
        for ($i = 0; $i -lt $n; $i++) { [RL]::Mouse([int]($dx / $n), [int]($dy / $n)); Start-Sleep -Milliseconds 10 }
        $out = 'ok' }
      'shot' { $g = Get-Game; if ($g) { $out = [string][RL]::Shot($g.MainWindowHandle, $p[1], [int]$p[2]) } else { $out = 'fail' } }
      'sheet' { [RL]::Sheet($p[1], [int]$p[2], $p[3..($p.Length - 1)]); $out = 'ok' }
      'quit' { [Console]::Out.WriteLine('bye'); [Console]::Out.Flush(); exit 0 }
      default { $out = 'unknown' }
    }
  } catch { $out = 'error ' + $_.Exception.Message }
  [Console]::Out.WriteLine($out); [Console]::Out.Flush()
}
