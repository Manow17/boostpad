// Puts OpenW in the Windows Start Menu, so it can be found by searching for it.
// Run with:  npm run shortcut          (add or refresh the shortcut)
//            npm run shortcut -- --remove
// It writes assets/icon.ico (from icon.png) and a shortcut that starts this copy
// of the app. Nothing is installed elsewhere; delete the shortcut to undo it.
const { app, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ico = path.join(root, 'assets', 'icon.ico');

// A .ico holding several sizes: small ones as plain bitmaps, 256px as PNG.
function buildIco(png) {
  const source = nativeImage.createFromPath(png);
  const entries = [16, 24, 32, 48, 64, 256].map((size) => {
    const image = source.resize({ width: size, height: size, quality: 'best' });
    if (size === 256) return { size, data: image.toPNG() };
    const bgra = image.toBitmap(); // top-down, premultiplied
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8); // height counts the mask too
    header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(size * size * 4, 20);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const from = (y * size + x) * 4, to = ((size - 1 - y) * size + x) * 4, a = bgra[from + 3]; // rows are stored bottom-up
        for (let c = 0; c < 3; c++) pixels[to + c] = a ? Math.min(255, Math.round((bgra[from + c] * 255) / a)) : 0;
        pixels[to + 3] = a;
      }
    }
    const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size); // all zero: the alpha channel does the work
    return { size, data: Buffer.concat([header, pixels, mask]) };
  });
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    dir[at] = size % 256; dir[at + 1] = size % 256; // 0 means 256
    dir.writeUInt16LE(1, at + 4); dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(data.length, at + 8); dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.data)]);
}

app.whenReady().then(() => {
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const link = path.join(programs, 'OpenW.lnk');
  fs.rmSync(path.join(programs, 'Boostpad.lnk'), { force: true }); // the app's old name
  if (process.argv.includes('--remove')) {
    fs.rmSync(link, { force: true });
    console.log(`removed ${link}`);
    return app.exit(0);
  }
  fs.writeFileSync(ico, buildIco(path.join(root, 'assets', 'icon.png')));
  const ok = shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', {
    target: process.execPath,            // the Electron that ships with this copy
    args: `"${root}"`,
    cwd: root,
    icon: ico,
    iconIndex: 0,
    description: 'OpenW: cosmetic mod manager for Rocket League',
    appUserModelId: 'io.github.openw', // same id the app sets, so the taskbar treats them as one
  });
  console.log(ok ? `shortcut written: ${link}` : 'could not write the shortcut');
  app.exit(ok ? 0 : 1);
});
