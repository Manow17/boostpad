// Renders assets/icon.svg to assets/icon.png (256px, transparent corners).
// Run with:  npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');
const SIZE = 512;

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8').replace('<svg', `<svg width="${SIZE}" height="${SIZE}"`);
  const win = new BrowserWindow({ width: SIZE, height: SIZE, useContentSize: true, show: false, frame: false, transparent: true });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;overflow:hidden;background:transparent">${svg}</body>`)}`);
  await new Promise((r) => setTimeout(r, 500));
  const image = (await win.webContents.capturePage()).resize({ width: 256, height: 256, quality: 'best' });
  fs.writeFileSync(path.join(assets, 'icon.png'), image.toPNG());
  console.log('wrote assets/icon.png');
  app.exit(0);
});
