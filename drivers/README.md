# Drivers that come with OpenW

OpenW Input plays your controller on a virtual Xbox controller, and can hide the real one from games. Both need a driver, and Windows only loads drivers signed through Microsoft, so OpenW ships the official, signed installers by Nefarius Software Solutions (the same drivers DS4Windows uses) instead of a driver of its own. OpenW installs them from the Controller page when you ask it to; Windows asks for administrator permission. Remove them any time under Windows Settings, Apps.

| File | Driver | Version | From | License | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `ViGEmBus_1.22.0_x64_x86_arm64.exe` | ViGEmBus: virtual game controllers | 1.22.0 | [github.com/nefarius/ViGEmBus](https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0) | BSD 3-Clause, [LICENSE-ViGEmBus.txt](LICENSE-ViGEmBus.txt) | `89220a7865076b342892f98865f3499fb7c4cfd673159e89d352c360fd014c6a` |
| `HidHide_1.5.230_x64.exe` | HidHide: hides devices from other apps | 1.5.230 | [github.com/nefarius/HidHide](https://github.com/nefarius/HidHide/releases/tag/v1.5.230.0) | MIT, [LICENSE-HidHide.txt](LICENSE-HidHide.txt) | `f4bbbcb82e6258641b887c74bc81c4c5f66e4aa811808dfc304347687b7605f6` |

Both files are unchanged from those releases and carry Nefarius Software Solutions e.U.'s Authenticode signature. OpenW checks the SHA-256 above before it runs either one (`src/main/input.js`), and runs them silently with `/exenoui /qn /norestart`.

ViGEmBus is retired by its author (no new versions), but 1.22.0 is the current, signed release and still works on Windows 10 and 11.
