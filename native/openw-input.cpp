// OpenW Input: reads the real controller, applies OpenW's stick, trigger and button settings,
// and plays the result on a virtual Xbox 360 controller through ViGEmBus.
//
//   Xbox (and other XInput) controllers are read through XInput, PlayStation controllers
//   (DualShock 4, DualSense, DualSense Edge) as raw HID reports, over USB or Bluetooth.
//   Every report is turned into the output at once and sent on, so nothing waits for a timer.
//   Rumble the game asks of the virtual pad goes back to the real one, and PlayStation
//   lightbars take the profile's colour.
//
// Talks to OpenW over stdin/stdout, one line per message (see src/main/input.js):
//   in:  stick/trigger/button/rumble/light lines, then "apply"; "watch 1|0"; "quit"
//   out: hello, vigem ..., pad ..., state ... (while watched), error ...
//   --own (or "own 1"): take a PlayStation controller for this process alone, so games cannot open it
// Without ViGEmBus it still reads the controller, so the page can show what the settings do.
// It quits when its stdin closes, and the virtual pad goes away with its handle.
//
// "openw-input --transform" only runs the transform on lines from stdin (for the tests).
//
// Build: npm run build-input (needs the Visual Studio C++ build tools).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winioctl.h>
#include <mmsystem.h>
#include <setupapi.h>
#include <hidsdi.h>
#include <hidpi.h>
#include <xinput.h>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include <thread>
#include <sstream>
#include <algorithm>

#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "hid.lib")
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "xinput.lib")

/* ---------------- output to OpenW ---------------- */

static std::mutex outLock;
static void say(const char* fmt, ...) {
  char buf[512];
  va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  std::lock_guard<std::mutex> g(outLock);
  fputs(buf, stdout); fputc('\n', stdout); fflush(stdout);
}

/* ---------------- settings ---------------- */

struct StickCfg {
  int shape = 0;            // 0 circle, 1 cross (each axis on its own), 2 square (full diagonals)
  double inner = 0.08, outer = 0.02, expo = 1, anti = 0, buffer = 0, scaleX = 1, scaleY = 1;
  int invX = 0, invY = 0;
  int output = 0;           // 0 left stick, 1 right stick, 2 nothing
  int axes = 0;             // 0 both, 1 horizontal only, 2 vertical only
  double ringAt = 0.9; int ringInvert = 0; uint32_t ringMask = 0; // outer ring binding
  double smoothing = 0;     // 0..1
};
struct TrigCfg { double start = 0, end = 1, expo = 1; int hair = 0; int output = 0; /* 0 left 1 right 2 none */ };
struct BtnCfg { uint32_t to = 0; int turbo = 0; double turboHz = 10; int toggle = 0; uint32_t hold = 0; int holdMs = 0; };

enum { SRC_COUNT = 21 };
struct Config {
  StickCfg stick[2];
  TrigCfg trig[2];
  BtnCfg btn[SRC_COUNT];
  int rumble = 100;         // percent
  int lightR = -1, lightG = 0, lightB = 0;
  Config() {
    stick[1].output = 1; trig[1].output = 1;
    // A B X Y LB RB LS RS Back Start Guide Up Down Left Right Touchpad Mute FnL FnR PaddleL PaddleR
    static const uint32_t def[SRC_COUNT] = { 0x1000, 0x2000, 0x4000, 0x8000, 0x100, 0x200, 0x40, 0x80, 0x20, 0x10, 0x400,
      0x1, 0x2, 0x4, 0x8, 0x20, 0, 0, 0, 0, 0 };
    for (int i = 0; i < SRC_COUNT; i++) btn[i].to = def[i];
  }
};

static const uint32_t OUT_LT = 0x10000, OUT_RT = 0x20000; // "full trigger" outputs for buttons

// One settings line; returns false if it is not one.
static bool parseLine(const std::string& line, Config& c) {
  std::istringstream in(line);
  std::string cmd; in >> cmd;
  if (cmd == "stick") {
    int i; in >> i; if (i < 0 || i > 1) return true;
    StickCfg& s = c.stick[i];
    in >> s.shape >> s.inner >> s.outer >> s.expo >> s.anti >> s.buffer >> s.scaleX >> s.scaleY >> s.invX >> s.invY
       >> s.output >> s.axes >> s.ringAt >> s.ringInvert >> s.ringMask >> s.smoothing;
    s.inner = std::clamp(s.inner, 0.0, 0.9); s.outer = std::clamp(s.outer, 0.0, 0.5);
    s.expo = std::clamp(s.expo, 0.1, 10.0); s.anti = std::clamp(s.anti, 0.0, 0.9); s.buffer = std::clamp(s.buffer, 0.0, 0.5);
    return true;
  }
  if (cmd == "trigger") {
    int i; in >> i; if (i < 0 || i > 1) return true;
    TrigCfg& t = c.trig[i];
    in >> t.start >> t.end >> t.expo >> t.hair >> t.output;
    t.start = std::clamp(t.start, 0.0, 0.95); t.end = std::clamp(t.end, t.start + 0.01, 1.0); t.expo = std::clamp(t.expo, 0.1, 10.0);
    return true;
  }
  if (cmd == "button") {
    int i; in >> i; if (i < 0 || i >= SRC_COUNT) return true;
    BtnCfg& b = c.btn[i];
    in >> b.to >> b.turbo >> b.turboHz >> b.toggle >> b.hold >> b.holdMs;
    b.turboHz = std::clamp(b.turboHz, 1.0, 30.0); b.holdMs = std::clamp(b.holdMs, 0, 3000);
    return true;
  }
  if (cmd == "rumble") { in >> c.rumble; c.rumble = std::clamp(c.rumble, 0, 200); return true; }
  if (cmd == "light") { in >> c.lightR >> c.lightG >> c.lightB; return true; }
  return false;
}

/* ---------------- the transform (src/shared/transform.js does the same; the tests compare them) ---------------- */

static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
static double sgn(double v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

// Magnitude past the dead zone -> output magnitude: dead zones, response curve, anti-deadzone.
static double shapeMag(double m, const StickCfg& c) {
  if (m <= c.inner) return 0;
  double span = std::max(0.01, 1 - c.outer - c.inner);
  double t = pow(clamp01((m - c.inner) / span), c.expo);
  if (c.anti > 0 && t > 0) {
    if (c.buffer > 0 && t < c.buffer) t = t / c.buffer * c.anti;
    else t = c.anti + (1 - c.anti) * (t - c.buffer) / (1 - c.buffer);
  }
  return clamp01(t);
}

static void stickXform(double x, double y, const StickCfg& c, double& ox, double& oy) {
  if (c.shape == 1) {
    ox = sgn(x) * shapeMag(fabs(x), c);
    oy = sgn(y) * shapeMag(fabs(y), c);
  } else {
    double m = sqrt(x * x + y * y);
    if (m < 1e-9) { ox = oy = 0; }
    else {
      double t = shapeMag(m, c);
      // square: the direction is stretched from the circle onto the square, so a diagonal reaches full on both axes
      double d = c.shape == 2 ? std::max(fabs(x), fabs(y)) : m;
      ox = x / d * t; oy = y / d * t;
    }
  }
  ox *= c.scaleX; oy *= c.scaleY;
  if (c.invX) ox = -ox;
  if (c.invY) oy = -oy;
  if (c.axes == 1) oy = 0; else if (c.axes == 2) ox = 0;
  ox = std::clamp(ox, -1.0, 1.0); oy = std::clamp(oy, -1.0, 1.0);
}

static double trigXform(double t, const TrigCfg& c) {
  double v = clamp01((t - c.start) / std::max(0.01, c.end - c.start));
  return v <= 0 ? 0 : pow(v, c.expo);
}

static int transformMode() {
  Config c; std::string line;
  char buf[256];
  while (fgets(buf, sizeof buf, stdin)) {
    line = buf;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    std::istringstream in(line); std::string cmd; in >> cmd;
    if (cmd == "in") { int i; double x, y, ox, oy; in >> i >> x >> y; stickXform(x, y, c.stick[i & 1], ox, oy); printf("out %.6f %.6f\n", ox, oy); }
    else if (cmd == "tin") { int i; double t; in >> i >> t; printf("tout %.6f\n", trigXform(t, c.trig[i & 1])); }
    else parseLine(line, c);
    fflush(stdout);
  }
  return 0;
}

/* ---------------- ViGEmBus: the virtual Xbox 360 controller ---------------- */

static const GUID VIGEM_BUS = { 0x96E42B22, 0xF5E9, 0x42F8, { 0xB0, 0x43, 0xED, 0x0F, 0x93, 0x2F, 0x01, 0x4F } };
#define BUS_IOCTL(fn, access) CTL_CODE(FILE_DEVICE_BUS_EXTENDER, fn, METHOD_BUFFERED, access)
static const DWORD IOCTL_PLUGIN = BUS_IOCTL(0x801, FILE_READ_DATA | FILE_WRITE_DATA);
static const DWORD IOCTL_CHECK_VERSION = BUS_IOCTL(0x803, FILE_READ_DATA | FILE_WRITE_DATA);
static const DWORD IOCTL_WAIT_READY = BUS_IOCTL(0x804, FILE_READ_DATA | FILE_WRITE_DATA);
static const DWORD IOCTL_XUSB_NOTIFY = BUS_IOCTL(0xA01, FILE_READ_DATA | FILE_WRITE_DATA);
static const DWORD IOCTL_XUSB_SUBMIT = BUS_IOCTL(0xA02, FILE_WRITE_DATA);
static const DWORD IOCTL_XUSB_USER_INDEX = BUS_IOCTL(0xA07, FILE_READ_DATA | FILE_WRITE_DATA);

struct VPlugin { ULONG Size, SerialNo; ULONG TargetType; USHORT VendorId, ProductId; };
struct VSerial { ULONG Size, SerialNo; };
struct VVersion { ULONG Size, Version; };
struct XReport { USHORT wButtons; BYTE bLeftTrigger, bRightTrigger; SHORT sThumbLX, sThumbLY, sThumbRX, sThumbRY; };
struct XSubmit { ULONG Size, SerialNo; XReport Report; };
struct XNotify { ULONG Size, SerialNo; UCHAR LargeMotor, SmallMotor, LedNumber; };
struct XUserIndex { ULONG Size, SerialNo, UserIndex; };

static bool busIo(HANDLE h, HANDLE ev, DWORD code, void* in, DWORD inLen, void* out, DWORD outLen) {
  OVERLAPPED ov = {}; ov.hEvent = ev; ResetEvent(ev);
  DWORD n = 0;
  BOOL ok = DeviceIoControl(h, code, in, inLen, out, outLen, &n, &ov);
  if (!ok && GetLastError() == ERROR_IO_PENDING) ok = GetOverlappedResult(h, &ov, &n, TRUE);
  return ok != FALSE;
}

static HANDLE vigem = INVALID_HANDLE_VALUE;
static ULONG vigemSerial = 0;
static std::atomic<int> vigemIndex{ -1 }; // XInput slot of the virtual pad, so it is never read as the real one
static HANDLE submitEvent = nullptr;

static bool openVigem() {
  HDEVINFO di = SetupDiGetClassDevsW(&VIGEM_BUS, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (di == INVALID_HANDLE_VALUE) return false;
  SP_DEVICE_INTERFACE_DATA ifd = { sizeof ifd };
  HANDLE ev = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  for (DWORD i = 0; vigem == INVALID_HANDLE_VALUE && SetupDiEnumDeviceInterfaces(di, nullptr, &VIGEM_BUS, i, &ifd); i++) {
    DWORD need = 0;
    SetupDiGetDeviceInterfaceDetailW(di, &ifd, nullptr, 0, &need, nullptr);
    std::vector<BYTE> mem(need);
    auto* det = (PSP_DEVICE_INTERFACE_DETAIL_DATA_W)mem.data();
    det->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(di, &ifd, det, need, nullptr, nullptr)) continue;
    HANDLE h = CreateFileW(det->DevicePath, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OVERLAPPED, nullptr);
    if (h == INVALID_HANDLE_VALUE) continue;
    VVersion v = { sizeof v, 1 };
    if (busIo(h, ev, IOCTL_CHECK_VERSION, &v, sizeof v, nullptr, 0)) vigem = h; else CloseHandle(h);
  }
  SetupDiDestroyDeviceInfoList(di);
  if (vigem == INVALID_HANDLE_VALUE) { CloseHandle(ev); return false; }
  // the bus hands out serial numbers: take the first free one
  for (ULONG serial = 1; serial <= 16 && !vigemSerial; serial++) {
    VPlugin p = { sizeof p, serial, 0 /* Xbox 360 wired */, 0x045E, 0x028E };
    if (busIo(vigem, ev, IOCTL_PLUGIN, &p, sizeof p, nullptr, 0)) vigemSerial = serial;
  }
  if (!vigemSerial) { CloseHandle(ev); CloseHandle(vigem); vigem = INVALID_HANDLE_VALUE; return false; }
  VSerial ready = { sizeof ready, vigemSerial };
  busIo(vigem, ev, IOCTL_WAIT_READY, &ready, sizeof ready, nullptr, 0); // older buses do not know it: fine
  for (int tries = 0; tries < 40; tries++) {
    XUserIndex ui = { sizeof ui, vigemSerial, 0 };
    if (busIo(vigem, ev, IOCTL_XUSB_USER_INDEX, &ui, sizeof ui, &ui, sizeof ui)) { vigemIndex = (int)ui.UserIndex; break; }
    Sleep(50);
  }
  CloseHandle(ev);
  submitEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  return true;
}

static XReport lastSent; static bool sentOnce = false;
static void submit(const XReport& r) {
  if (vigem == INVALID_HANDLE_VALUE) return;
  if (sentOnce && !memcmp(&r, &lastSent, sizeof r)) return;
  XSubmit s = { sizeof s, vigemSerial, r };
  if (busIo(vigem, submitEvent, IOCTL_XUSB_SUBMIT, &s, sizeof s, nullptr, 0)) { lastSent = r; sentOnce = true; }
}

/* ---------------- the real controller ---------------- */

struct Raw { double lx = 0, ly = 0, rx = 0, ry = 0, lt = 0, rt = 0; uint32_t buttons = 0; };
enum Kind { NONE, XINPUT, DS4, DUALSENSE, EDGE };
static const char* KIND_NAME[] = { "none", "xinput", "ds4", "dualsense", "edge" };

static std::mutex stepLock;
static Config cfg, pending;
static std::atomic<bool> quitting{ false };
static std::atomic<int> watching{ 0 };
// Take a PlayStation controller for ourselves (no sharing), so games cannot open it: hiding
// without HidHide. Windows only allows it while no other app has the controller open.
static std::atomic<bool> wantOwn{ false }, reopen{ false };
static Raw shownRaw; static XReport shownOut = {};

// what the active controller is, for rumble and light
static std::mutex padLock;
static Kind padKind = NONE; static bool padBt = false; static int padSlot = -1;
static HANDLE padHid = INVALID_HANDLE_VALUE; static USHORT padOutLen = 0;

/* --- buttons: turbo, toggle, long press --- */
struct BtnState { bool prev = false, latched = false, holdFired = false, regPrev = false; ULONGLONG downAt = 0, tapUntil = 0, turboFrom = 0; };
static BtnState bstate[SRC_COUNT];
struct Hair { bool on = false; double ref = 0; } hair[2];
static double smooth[2][2] = {}; static ULONGLONG lastStep = 0;

static void step(const Raw& raw) {
  std::lock_guard<std::mutex> g(stepLock);
  const Config& c = cfg;
  ULONGLONG now = GetTickCount64();
  double dt = lastStep ? (double)(now - lastStep) : 1; lastStep = now;

  double sx[2] = { raw.lx, raw.rx }, sy[2] = { raw.ly, raw.ry };
  double outX[3] = {}, outY[3] = {};
  uint32_t mask = 0;
  for (int i = 0; i < 2; i++) {
    const StickCfg& s = c.stick[i];
    double ox, oy; stickXform(sx[i], sy[i], s, ox, oy);
    if (s.smoothing > 0) {
      double a = 1 - exp(-std::max(dt, 1.0) / (s.smoothing * 40));
      smooth[i][0] += (ox - smooth[i][0]) * a; smooth[i][1] += (oy - smooth[i][1]) * a;
      ox = smooth[i][0]; oy = smooth[i][1];
    } else { smooth[i][0] = ox; smooth[i][1] = oy; }
    int o = std::clamp(s.output, 0, 2);
    outX[o] += ox; outY[o] += oy;
    if (s.ringMask) {
      bool past = sqrt(sx[i] * sx[i] + sy[i] * sy[i]) > s.ringAt;
      if (past != (s.ringInvert != 0)) mask |= s.ringMask;
    }
  }
  double tin[2] = { raw.lt, raw.rt }, tout[3] = {};
  for (int i = 0; i < 2; i++) {
    const TrigCfg& t = c.trig[i];
    double v;
    if (t.hair) {
      // full as soon as it moves down, off as soon as it moves back up
      Hair& hs = hair[i]; double x = tin[i];
      if (!hs.on) { if (x > t.start && x > hs.ref + 0.03) { hs.on = true; hs.ref = x; } else hs.ref = std::min(hs.ref, x); }
      else { if (x > hs.ref) hs.ref = x; else if (x < hs.ref - 0.03 || x <= t.start) { hs.on = false; hs.ref = x; } }
      v = hs.on ? 1 : 0;
    } else v = trigXform(tin[i], t);
    tout[std::clamp(t.output, 0, 2)] += v;
  }
  for (int i = 0; i < SRC_COUNT; i++) {
    const BtnCfg& b = c.btn[i]; BtnState& st = bstate[i];
    bool pressed = (raw.buttons >> i) & 1;
    bool reg;
    if (b.hold && b.holdMs > 0) {
      // long press: the second binding after holdMs; a shorter press sends the first one briefly on release
      if (pressed && !st.prev) { st.downAt = now; st.holdFired = false; }
      if (pressed && !st.holdFired && now - st.downAt >= (ULONGLONG)b.holdMs) st.holdFired = true;
      if (!pressed && st.prev && !st.holdFired) st.tapUntil = now + 60;
      if (pressed && st.holdFired) mask |= b.hold;
      reg = now < st.tapUntil;
    } else reg = pressed;
    if (b.toggle) { if (reg && !st.regPrev) st.latched = !st.latched; st.regPrev = reg; reg = st.latched; }
    else st.regPrev = reg;
    if (b.turbo && reg) {
      if (!st.turboFrom) st.turboFrom = now;
      double period = 1000.0 / b.turboHz;
      reg = fmod((double)(now - st.turboFrom), period) < period / 2;
    } else if (!reg) st.turboFrom = 0;
    if (reg) mask |= b.to;
    st.prev = pressed;
  }
  XReport r = {};
  r.wButtons = (USHORT)(mask & 0xFFFF);
  auto axis = [](double v) { return (SHORT)lround(std::clamp(v, -1.0, 1.0) * 32767); };
  auto trig = [](double v) { return (BYTE)lround(clamp01(v) * 255); };
  r.sThumbLX = axis(outX[0]); r.sThumbLY = axis(outY[0]); r.sThumbRX = axis(outX[1]); r.sThumbRY = axis(outY[1]);
  r.bLeftTrigger = (mask & OUT_LT) ? 255 : trig(tout[0]);
  r.bRightTrigger = (mask & OUT_RT) ? 255 : trig(tout[1]);
  submit(r);
  shownRaw = raw; shownOut = r;
}

/* --- PlayStation controllers over HID --- */

static uint32_t crcTable[256];
static void crcInit() { for (uint32_t i = 0; i < 256; i++) { uint32_t c = i; for (int k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >> 1) : c >> 1; crcTable[i] = c; } }
static uint32_t crc32(uint32_t crc, const BYTE* p, size_t n) { crc = ~crc; while (n--) crc = crcTable[(crc ^ *p++) & 0xFF] ^ (crc >> 8); return ~crc; }
// Bluetooth output reports end with a CRC over 0xA2 and the report
static void btCrc(BYTE* buf, size_t len) {
  BYTE head = 0xA2;
  uint32_t c = crc32(crc32(0, &head, 1), buf, len - 4);
  memcpy(buf + len - 4, &c, 4);
}

static std::atomic<int> motorBig{ 0 }, motorSmall{ 0 };
static bool dsLightSetup = false;
static BYTE dsSeq = 0;

// Sends rumble and light to the real controller.
static void sendFeedback() {
  std::lock_guard<std::mutex> g(padLock);
  int pct; int lr, lg, lb;
  { std::lock_guard<std::mutex> s(stepLock); pct = cfg.rumble; lr = cfg.lightR; lg = cfg.lightG; lb = cfg.lightB; }
  int big = std::min(255, motorBig * pct / 100), small = std::min(255, motorSmall * pct / 100);
  if (padKind == XINPUT && padSlot >= 0) {
    XINPUT_VIBRATION v = { (WORD)(big * 257), (WORD)(small * 257) };
    XInputSetState(padSlot, &v);
    return;
  }
  if (padHid == INVALID_HANDLE_VALUE) return;
  std::vector<BYTE> buf(std::max<size_t>(padOutLen, 78), 0);
  size_t len = 0;
  if (padKind == DS4) {
    BYTE* d;
    if (!padBt) { buf[0] = 0x05; buf[1] = lr >= 0 ? 0x07 : 0x01; d = &buf[4]; len = 32; }
    else { buf[0] = 0x11; buf[1] = 0xC0; buf[3] = lr >= 0 ? 0x07 : 0x01; d = &buf[6]; len = 78; }
    d[0] = (BYTE)small; d[1] = (BYTE)big;
    if (lr >= 0) { d[2] = (BYTE)lr; d[3] = (BYTE)lg; d[4] = (BYTE)lb; }
  } else {
    BYTE* common;
    if (!padBt) { buf[0] = 0x02; common = &buf[1]; len = 48; }
    else { buf[0] = 0x31; buf[1] = (BYTE)(dsSeq++ << 4); buf[2] = 0x10; common = &buf[3]; len = 78; }
    common[0] = 0x01 | 0x02;                 // rumble the way an Xbox pad does
    common[2] = (BYTE)small; common[3] = (BYTE)big;
    if (lr >= 0) {
      common[1] = 0x04;                        // lightbar colour
      if (!dsLightSetup) { common[38] = 0x02; common[41] = 0x02; dsLightSetup = true; } // let go of the start-up blue
      common[44] = (BYTE)lr; common[45] = (BYTE)lg; common[46] = (BYTE)lb;
    }
  }
  if (padBt) btCrc(buf.data(), len);
  DWORD n = std::max<DWORD>((DWORD)len, padOutLen);
  OVERLAPPED ov = {}; ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!WriteFile(padHid, buf.data(), n, nullptr, &ov) && GetLastError() == ERROR_IO_PENDING) {
    if (WaitForSingleObject(ov.hEvent, 200) != WAIT_OBJECT_0) CancelIo(padHid);
  }
  CloseHandle(ov.hEvent);
}

static void hat(int v, uint32_t& b) {
  static const uint32_t dirs[8] = { 1, 1 | 8, 8, 2 | 8, 2, 2 | 4, 4, 1 | 4 }; // up right down left as bits 0..3
  if (v < 8) { uint32_t d = dirs[v]; if (d & 1) b |= 1u << 11; if (d & 2) b |= 1u << 12; if (d & 4) b |= 1u << 13; if (d & 8) b |= 1u << 14; }
}
static double stickByte(BYTE v) { return std::clamp((v - 127.5) / 127.5, -1.0, 1.0); }

// Face and shoulder bytes, the same on DualShock 4 and DualSense.
static void psButtons(BYTE b0, BYTE b1, BYTE b2, uint32_t& b) {
  hat(b0 & 0x0F, b);
  if (b0 & 0x10) b |= 1u << 2;  // square -> X
  if (b0 & 0x20) b |= 1u << 0;  // cross -> A
  if (b0 & 0x40) b |= 1u << 1;  // circle -> B
  if (b0 & 0x80) b |= 1u << 3;  // triangle -> Y
  if (b1 & 0x01) b |= 1u << 4; if (b1 & 0x02) b |= 1u << 5;
  if (b1 & 0x10) b |= 1u << 8; if (b1 & 0x20) b |= 1u << 9;
  if (b1 & 0x40) b |= 1u << 6; if (b1 & 0x80) b |= 1u << 7;
  if (b2 & 0x01) b |= 1u << 10; if (b2 & 0x02) b |= 1u << 15;
}

static bool parseReport(Kind kind, bool usbLayout, const BYTE* d, DWORD n, Raw& r) {
  int o; BYTE b0, b1, b2, l2, r2;
  if (kind == DS4) {
    if (d[0] == 0x01 && n >= 10) o = 1; else if (d[0] == 0x11 && n >= 12) o = 3; else return false;
    r.lx = stickByte(d[o]); r.ly = -stickByte(d[o + 1]); r.rx = stickByte(d[o + 2]); r.ry = -stickByte(d[o + 3]);
    b0 = d[o + 4]; b1 = d[o + 5]; b2 = d[o + 6]; l2 = d[o + 7]; r2 = d[o + 8];
  } else {
    if (d[0] == 0x01 && !usbLayout && n >= 10) { // Bluetooth before the full reports start
      r.lx = stickByte(d[1]); r.ly = -stickByte(d[2]); r.rx = stickByte(d[3]); r.ry = -stickByte(d[4]);
      b0 = d[5]; b1 = d[6]; b2 = d[7]; l2 = d[8]; r2 = d[9];
    } else {
      if (d[0] == 0x01 && n >= 11) o = 1; else if (d[0] == 0x31 && n >= 12) o = 2; else return false;
      r.lx = stickByte(d[o]); r.ly = -stickByte(d[o + 1]); r.rx = stickByte(d[o + 2]); r.ry = -stickByte(d[o + 3]);
      l2 = d[o + 4]; r2 = d[o + 5]; b0 = d[o + 7]; b1 = d[o + 8]; b2 = d[o + 9];
    }
  }
  r.lt = l2 / 255.0; r.rt = r2 / 255.0;
  uint32_t b = 0; psButtons(b0, b1, b2, b);
  if (kind != DS4) {
    if (b2 & 0x04) b |= 1u << 16;                     // mute
    if (kind == EDGE) { if (b2 & 0x10) b |= 1u << 17; if (b2 & 0x20) b |= 1u << 18; if (b2 & 0x40) b |= 1u << 19; if (b2 & 0x80) b |= 1u << 20; }
  }
  r.buttons = b;
  return true;
}

static Kind psKind(USHORT vid, USHORT pid) {
  if (vid != 0x054C) return NONE;
  if (pid == 0x05C4 || pid == 0x09CC || pid == 0x0BA0) return DS4;
  if (pid == 0x0CE6) return DUALSENSE;
  if (pid == 0x0DF2) return EDGE;
  return NONE;
}

// Reads one PlayStation controller until it goes away. Returns false if none was found.
static bool runHid() {
  GUID hidGuid; HidD_GetHidGuid(&hidGuid);
  HDEVINFO di = SetupDiGetClassDevsW(&hidGuid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (di == INVALID_HANDLE_VALUE) return false;
  SP_DEVICE_INTERFACE_DATA ifd = { sizeof ifd };
  HANDLE h = INVALID_HANDLE_VALUE; Kind kind = NONE; HIDP_CAPS caps = {}; bool own = false;
  for (DWORD i = 0; h == INVALID_HANDLE_VALUE && SetupDiEnumDeviceInterfaces(di, nullptr, &hidGuid, i, &ifd); i++) {
    DWORD need = 0;
    SetupDiGetDeviceInterfaceDetailW(di, &ifd, nullptr, 0, &need, nullptr);
    std::vector<BYTE> mem(need);
    auto* det = (PSP_DEVICE_INTERFACE_DETAIL_DATA_W)mem.data();
    det->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(di, &ifd, det, need, nullptr, nullptr)) continue;
    // a handle without read or write access does not count against sharing
    HANDLE dev = CreateFileW(det->DevicePath, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
    if (dev == INVALID_HANDLE_VALUE) continue;
    HIDD_ATTRIBUTES a = { sizeof a };
    Kind k = HidD_GetAttributes(dev, &a) ? psKind(a.VendorID, a.ProductID) : NONE;
    PHIDP_PREPARSED_DATA pp;
    if (k != NONE && HidD_GetPreparsedData(dev, &pp)) {
      HidP_GetCaps(pp, &caps); HidD_FreePreparsedData(pp);
      if (caps.UsagePage == 1 && (caps.Usage == 5 || caps.Usage == 4)) {
        CloseHandle(dev);
        if (wantOwn) {
          h = CreateFileW(det->DevicePath, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
          own = h != INVALID_HANDLE_VALUE;
        }
        if (h == INVALID_HANDLE_VALUE) // another app has it open: share it
          h = CreateFileW(det->DevicePath, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
        if (h != INVALID_HANDLE_VALUE) kind = k;
        continue;
      }
    }
    CloseHandle(dev);
  }
  SetupDiDestroyDeviceInfoList(di);
  if (h == INVALID_HANDLE_VALUE) return false;

  bool usb = caps.InputReportByteLength == 64;
  if (!usb) {
    // over Bluetooth the full reports start once the calibration is read
    std::vector<BYTE> f(std::max<USHORT>(caps.FeatureReportByteLength, 64), 0);
    f[0] = 0x05; if (!HidD_GetFeature(h, f.data(), caps.FeatureReportByteLength)) { f[0] = 0x02; HidD_GetFeature(h, f.data(), caps.FeatureReportByteLength); }
  }
  { std::lock_guard<std::mutex> g(padLock); padKind = kind; padBt = !usb; padHid = h; padOutLen = caps.OutputReportByteLength; padSlot = -1; dsLightSetup = false; }
  say("pad %s %s 0 %s", KIND_NAME[kind], usb ? "usb" : "bt", own ? "own" : "shared");
  sendFeedback();

  std::vector<BYTE> buf(std::max<USHORT>(caps.InputReportByteLength, 64));
  OVERLAPPED ov = {}; ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  int silent = 0;
  while (!quitting && !reopen) {
    ResetEvent(ov.hEvent);
    DWORD n = 0;
    if (!ReadFile(h, buf.data(), (DWORD)buf.size(), nullptr, &ov) && GetLastError() != ERROR_IO_PENDING) break;
    DWORD w = WaitForSingleObject(ov.hEvent, 1000);
    if (w != WAIT_OBJECT_0) { CancelIo(h); GetOverlappedResult(h, &ov, &n, TRUE); if (++silent > 3) break; continue; }
    if (!GetOverlappedResult(h, &ov, &n, FALSE)) break;
    silent = 0;
    Raw r;
    if (parseReport(kind, usb, buf.data(), n, r)) step(r);
  }
  CancelIo(h);
  CloseHandle(ov.hEvent);
  reopen = false;
  { std::lock_guard<std::mutex> g(padLock); padKind = NONE; padHid = INVALID_HANDLE_VALUE; }
  CloseHandle(h);
  say("pad none");
  return true;
}

/* --- Xbox controllers through XInput (with the guide button) --- */

typedef DWORD(WINAPI* GetStateEx)(DWORD, XINPUT_STATE*);
static GetStateEx xGet = nullptr;

static uint32_t xButtons(WORD w) {
  static const WORD bits[15] = { 0x1000, 0x2000, 0x4000, 0x8000, 0x100, 0x200, 0x40, 0x80, 0x20, 0x10, 0x400, 0x1, 0x2, 0x4, 0x8 };
  uint32_t b = 0;
  for (int i = 0; i < 15; i++) if (w & bits[i]) b |= 1u << i;
  return b;
}

static int findXInput() {
  XINPUT_STATE s;
  for (int i = 0; i < 4; i++) if (i != vigemIndex && xGet(i, &s) == ERROR_SUCCESS) return i;
  return -1;
}

static bool runXInput() {
  int slot = findXInput();
  if (slot < 0) return false;
  { std::lock_guard<std::mutex> g(padLock); padKind = XINPUT; padSlot = slot; padHid = INVALID_HANDLE_VALUE; }
  say("pad xinput usb %d shared", slot);
  HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  XINPUT_STATE s;
  while (!quitting && !reopen) {
    if (xGet(slot, &s) != ERROR_SUCCESS) break;
    const XINPUT_GAMEPAD& g = s.Gamepad;
    Raw r;
    r.lx = std::max(-1.0, g.sThumbLX / 32767.0); r.ly = std::max(-1.0, g.sThumbLY / 32767.0);
    r.rx = std::max(-1.0, g.sThumbRX / 32767.0); r.ry = std::max(-1.0, g.sThumbRY / 32767.0);
    r.lt = g.bLeftTrigger / 255.0; r.rt = g.bRightTrigger / 255.0;
    r.buttons = xButtons(g.wButtons);
    step(r); // every millisecond, so turbo and long presses keep time
    if (timer) { LARGE_INTEGER due; due.QuadPart = -10000; SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE); WaitForSingleObject(timer, 5); }
    else Sleep(1);
  }
  if (timer) CloseHandle(timer);
  reopen = false;
  { std::lock_guard<std::mutex> g(padLock); padKind = NONE; padSlot = -1; }
  say("pad none");
  return true;
}

/* ---------------- threads ---------------- */

// Rumble the game sends to the virtual pad.
static void rumbleThread() {
  HANDLE ev = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  while (!quitting && vigem != INVALID_HANDLE_VALUE) {
    XNotify n = { sizeof(XNotify), vigemSerial, 0, 0, 0 };
    if (!busIo(vigem, ev, IOCTL_XUSB_NOTIFY, &n, sizeof n, &n, sizeof n)) { Sleep(200); continue; }
    motorBig = n.LargeMotor; motorSmall = n.SmallMotor;
    sendFeedback();
  }
  CloseHandle(ev);
}

static void watchThread() {
  while (!quitting) {
    Sleep(16);
    if (!watching) continue;
    Raw r; XReport o;
    { std::lock_guard<std::mutex> g(stepLock); r = shownRaw; o = shownOut; }
    say("state %.3f %.3f %.3f %.3f %.3f %.3f %u %.3f %.3f %.3f %.3f %.3f %.3f %u", r.lx, r.ly, r.rx, r.ry, r.lt, r.rt, r.buttons,
      o.sThumbLX / 32767.0, o.sThumbLY / 32767.0, o.sThumbRX / 32767.0, o.sThumbRY / 32767.0, o.bLeftTrigger / 255.0, o.bRightTrigger / 255.0, (unsigned)o.wButtons
      | (o.bLeftTrigger == 255 ? OUT_LT : 0) | (o.bRightTrigger == 255 ? OUT_RT : 0));
  }
}

static void inputThread() {
  char buf[512];
  while (fgets(buf, sizeof buf, stdin)) {
    std::string line = buf;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty()) continue;
    if (line == "quit") break;
    if (line == "apply") {
      { std::lock_guard<std::mutex> g(stepLock); cfg = pending; }
      sendFeedback();
      continue;
    }
    if (line.rfind("watch ", 0) == 0) { watching = atoi(line.c_str() + 6); continue; }
    // let go of the controller and open it again (to take it for ourselves, or to share it)
    if (line.rfind("own ", 0) == 0) { wantOwn = atoi(line.c_str() + 4) != 0; reopen = true; continue; }
    if (line == "reopen") { reopen = true; continue; }
    if (!parseLine(line, pending)) say("error BAD_LINE %s", line.c_str());
  }
  quitting = true; // OpenW closed or asked: let go of everything
}

int main(int argc, char** argv) {
  if (argc > 1 && !strcmp(argv[1], "--transform")) return transformMode();
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "--own")) wantOwn = true;
  HANDLE once = CreateMutexW(nullptr, TRUE, L"Local\\OpenWInput");
  if (GetLastError() == ERROR_ALREADY_EXISTS) { say("error RUNNING OpenW Input is already running"); return 2; }
  crcInit();
  timeBeginPeriod(1);
  SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
  say("hello 1");

  HMODULE xi = LoadLibraryW(L"xinput1_4.dll");
  if (xi) xGet = (GetStateEx)GetProcAddress(xi, (LPCSTR)100); // XInputGetStateEx: also reports the guide button
  if (!xGet) xGet = (GetStateEx)XInputGetState;

  if (openVigem()) say("vigem ok %d", (int)vigemIndex);
  else say("vigem missing");

  std::thread(inputThread).detach();
  std::thread(watchThread).detach();
  if (vigem != INVALID_HANDLE_VALUE) std::thread(rumbleThread).detach();

  // one controller at a time: PlayStation pads first, then XInput; look again every second
  bool told = false;
  while (!quitting) {
    if (runHid() || runXInput()) { told = false; continue; }
    if (!told) { say("pad none"); told = true; }
    for (int i = 0; i < 10 && !quitting; i++) Sleep(100);
  }
  // stop the real pad rumbling, unplug the virtual one
  motorBig = 0; motorSmall = 0; sendFeedback();
  if (vigem != INVALID_HANDLE_VALUE) CloseHandle(vigem);
  timeEndPeriod(1);
  return 0;
}
