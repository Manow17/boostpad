#!/usr/bin/env node
// Optional Boostpad sync server: lets users see each other's profile cards and
// share presets. No dependencies. Run:  node server/server.js  [port]
// Data is one JSON file next to this script. Host it anywhere, or not at all.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const FILE = path.join(__dirname, 'data.json');
const MAX_BODY = 600 * 1024;
const ID = /^[\w-]{8,64}$/;

let db = { profiles: {}, presets: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* fresh start */ }
const save = () => fs.writeFileSync(FILE, JSON.stringify(db));

const str = (v, max) => String(v ?? '').slice(0, max);
function cleanProfile(p) {
  const avatar = str(p.avatar, 560 * 1024);
  return {
    name: str(p.name, 24), title: str(p.title, 32), rank: str(p.rank, 24), glow: !!p.glow,
    titleColor: /^#[0-9a-f]{6}$/i.test(p.titleColor) ? p.titleColor : '#ffffff',
    avatar: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) ? avatar : '',
  };
}
function cleanPreset(p) {
  const ops = (Array.isArray(p.ops) ? p.ops : []).slice(0, 60)
    .filter((o) => o && o.kind === 'swap')
    .map((o) => ({ kind: 'swap', sourceFile: str(o.sourceFile, 120), targetFile: str(o.targetFile, 120), label: str(o.label, 120), category: str(o.category, 24) }));
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: str(p.name, 40), author: str(p.author, 24), ops, at: Date.now() };
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-secret',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  try {
    const [, kind, id] = new URL(req.url, 'http://x').pathname.split('/');
    if (req.method === 'OPTIONS') return send(res, 204);

    if (kind === 'profiles' && ID.test(id || '')) {
      const existing = db.profiles[id];
      if (req.method === 'GET') return existing ? send(res, 200, existing.profile) : send(res, 404, { error: 'not found' });
      if (req.method === 'PUT') {
        const secret = str(req.headers['x-secret'], 64);
        if (!secret) return send(res, 400, { error: 'x-secret header required' });
        if (existing && existing.secret !== secret) return send(res, 403, { error: 'wrong secret' }); // first writer owns the ID
        db.profiles[id] = { secret, profile: cleanProfile(await readBody(req)) };
        save();
        return send(res, 200, { ok: true });
      }
    }
    if (kind === 'presets' && !id) {
      if (req.method === 'GET') return send(res, 200, db.presets.slice(-200).reverse());
      if (req.method === 'POST') {
        const preset = cleanPreset(await readBody(req));
        if (!preset.ops.length) return send(res, 400, { error: 'preset has no swaps' });
        db.presets.push(preset);
        db.presets = db.presets.slice(-1000);
        save();
        return send(res, 200, preset);
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`Boostpad sync server on http://localhost:${PORT}`));
