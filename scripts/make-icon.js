// Turns assets/icon-source.webp (artwork on a plain light backdrop) into
// assets/icon.png: backdrop removed, cropped to the artwork, 256px square.
// Run with:  npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');

// Runs in the page: returns a PNG data URL.
const PROCESS = async (dataUrl, size, margin) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h), px = image.data;

  // Flood-fill the backdrop from the corners, so light shapes inside the artwork stay.
  const bg = [px[0], px[1], px[2]];
  const distance = (i) => Math.abs(px[i * 4] - bg[0]) + Math.abs(px[i * 4 + 1] - bg[1]) + Math.abs(px[i * 4 + 2] - bg[2]);
  const isBackdrop = (i) => distance(i) < 60;
  const seen = new Uint8Array(w * h), stack = [0, w - 1, (h - 1) * w, h * w - 1];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !isBackdrop(i)) continue;
    seen[i] = 1;
    px[i * 4 + 3] = 0;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < (h - 1) * w) stack.push(i + w);
  }
  ctx.putImageData(image, 0, 0);

  // Crop to what is left and centre it in a square.
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || distance(i) < 110) continue; // faint specks in the backdrop do not count as artwork
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const side = Math.max(x1 - x0, y1 - y0) + 1;
  const out = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  const scale = (size - 2 * margin) / side;
  octx.drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1,
    margin + ((side - (x1 - x0 + 1)) / 2) * scale, margin + ((side - (y1 - y0 + 1)) / 2) * scale, (x1 - x0 + 1) * scale, (y1 - y0 + 1) * scale);
  return out.toDataURL('image/png');
};

app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(assets, 'icon-source.webp')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const png = await win.webContents.executeJavaScript(`(${PROCESS})(${JSON.stringify(`data:image/webp;base64,${source}`)}, 256, 8)`);
  fs.writeFileSync(path.join(assets, 'icon.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote assets/icon.png');
  app.exit(0);
});
