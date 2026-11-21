// Builds bin/openw-input.exe from native/openw-input.cpp with the Visual Studio C++ build tools.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pf86 = process.env['ProgramFiles(x86)'] || 'C:\Program Files (x86)';
function vcvars() {
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const found = [];
  if (fs.existsSync(vswhere)) {
    try {
      const out = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) if (line.trim()) found.push(path.join(line.trim(), 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'));
    } catch { /* look in the usual places */ }
  }
  for (const year of ['2022', '2019']) for (const ed of ['BuildTools', 'Community', 'Professional', 'Enterprise']) {
    for (const base of [pf86, process.env.ProgramFiles || 'C:\Program Files']) found.push(path.join(base, 'Microsoft Visual Studio', year, ed, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'));
  }
  return found.find((f) => fs.existsSync(f));
}

const bat = vcvars();
if (!bat) { console.error('The Visual Studio C++ build tools were not found (vcvars64.bat).'); process.exit(1); }
fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
const obj = path.join(require('os').tmpdir(), 'openw-input-build');
fs.mkdirSync(obj, { recursive: true });
const cmd = `call "${bat}" >nul 2>nul && cl /nologo /O2 /MT /EHsc /std:c++17 /W3 /Fo"${obj}\\\\" "${path.join(root, 'native', 'openw-input.cpp')}" /link /OUT:"${path.join(root, 'bin', 'openw-input.exe')}"`;
const tmp = path.join(obj, 'build.cmd');
fs.writeFileSync(tmp, `@echo off\r\n${cmd}\r\n`);
try {
  execFileSync('cmd.exe', ['/d', '/c', tmp], { stdio: 'inherit' });
  console.log('built bin/openw-input.exe');
} catch { process.exit(1); }
