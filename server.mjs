// Janta ka Mantar: counter server
// Zero dependencies (Node 20+ built-ins only), so there is no third-party code to audit or compromise.
//
// What this server stores, in total:
//   data/state.json   -> { count, since, history: [[time, added], ...] }   (numbers only)
//   data/keys.json    -> its own secret keys (never served)
//
// What it never stores or reads: IP addresses, user agents, cookies, names, phone numbers,
// request logs of any kind. Search this file for "remoteAddress" — it is never used.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- configuration (environment variables) ----------
const CFG = {
  host: process.env.HOST || '127.0.0.1',               // listen only locally; the TLS proxy sits in front
  port: Number(process.env.PORT || 8787),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(HERE, 'data')),
  since: process.env.SINCE || '2026-10-11',
  domain: process.env.SITE_DOMAIN || '127.0.0.1:8787',      // e.g. jantakamantar.org
  source: process.env.SOURCE_URL || '#',                      // link to the public code            // the date shown under the counter
  batchSeconds: Number(process.env.BATCH_SECONDS || 60),   // count is published in batches, never per tap
  baseBits: Number(process.env.POW_BITS || 18),        // proof-of-work difficulty (each +1 doubles the cost)
  maxBits: Number(process.env.POW_MAX_BITS || 24),
  surgePerMin: Number(process.env.SURGE_PER_MIN || 3000),  // above this rate, difficulty rises automatically
  challengeTtl: 15 * 60,                               // seconds a challenge stays valid
  historyLen: 2000,                                    // how many batches of public history to keep
};

fs.mkdirSync(CFG.dataDir, { recursive: true, mode: 0o700 });

// ---------- keys (generated once, kept private) ----------
const KEYS_FILE = path.join(CFG.dataDir, 'keys.json');
function loadKeys() {
  if (fs.existsSync(KEYS_FILE)) {
    const k = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    return {
      hmac: Buffer.from(k.hmac, 'base64'),
      signKey: crypto.createPrivateKey(k.signPrivatePem),
      publicPem: k.signPublicPem,
    };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const k = {
    hmac: crypto.randomBytes(32).toString('base64'),
    signPrivatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    signPublicPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(k), { mode: 0o600 });
  return loadKeys();
}
const KEYS = loadKeys();

// ---------- state ----------
const STATE_FILE = path.join(CFG.dataDir, 'state.json');
let state = { count: 0, since: CFG.since, history: [] };
if (fs.existsSync(STATE_FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };

function saveState() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE); // atomic replace: a crash can never leave a half-written count
}

let pending = 0;                 // taps received since the last batch (not published until the batch closes)
let snapshot = null;             // the signed, public count

function sign(count, updated) {
  const msg = `janta-ka-mantar|${count}|${updated}|${state.since}`;
  return crypto.sign(null, Buffer.from(msg), KEYS.signKey).toString('base64');
}
function makeSnapshot() {
  const updated = Math.floor(Date.now() / 1000);
  snapshot = { count: state.count, since: state.since, updated, sig: sign(state.count, updated) };
}

function flushBatch() {
  const added = pending;
  pending = 0;
  if (added > 0) {
    state.count += added;
    state.history.push([Math.floor(Date.now() / 1000), added]);
    if (state.history.length > CFG.historyLen) state.history.splice(0, state.history.length - CFG.historyLen);
    saveState();
  }
  makeSnapshot();
}
makeSnapshot();
setInterval(flushBatch, CFG.batchSeconds * 1000).unref();

// ---------- proof-of-work (self-hosted, no third parties) ----------
// A challenge is stateless: random salt + expiry + difficulty, signed with our HMAC key.
// Each solved challenge can be spent exactly once (we remember spent salts until they expire).
const spent = new Map(); // salt -> expiry  (random values only; nothing about the person)
let acceptedThisMinute = 0, acceptedLastMinute = 0;
setInterval(() => {
  acceptedLastMinute = acceptedThisMinute; acceptedThisMinute = 0;
  const now = Date.now() / 1000;
  for (const [s, exp] of spent) if (exp < now) spent.delete(s);
}, 60_000).unref();

function currentBits() {
  // Automatic surge protection: every doubling of traffic above the threshold adds one bit (doubles cost).
  const rate = Math.max(acceptedLastMinute, acceptedThisMinute);
  const extra = rate > CFG.surgePerMin ? Math.ceil(Math.log2(rate / CFG.surgePerMin)) : 0;
  return Math.min(CFG.baseBits + extra, CFG.maxBits);
}
const hmac = (s) => crypto.createHmac('sha256', KEYS.hmac).update(s).digest('base64url');

function newChallenge() {
  const salt = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + CFG.challengeTtl;
  const challenge = `${salt}:${exp}:${currentBits()}`;
  return { challenge, sig: hmac(challenge) };
}

function leadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

function verifySolution({ challenge, sig, nonce }) {
  if (typeof challenge !== 'string' || typeof sig !== 'string' || typeof nonce !== 'string') return 'bad';
  if (challenge.length > 100 || sig.length > 100 || !/^\d{1,12}$/.test(nonce)) return 'bad';
  const expected = Buffer.from(hmac(challenge));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return 'bad';
  const [salt, expStr, bitsStr] = challenge.split(':');
  const exp = Number(expStr), bits = Number(bitsStr);
  if (exp < Date.now() / 1000) return 'expired';
  if (spent.has(salt)) return 'used';
  const hash = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
  if (leadingZeroBits(hash) < bits) return 'bad';
  spent.set(salt, exp);
  return 'ok';
}

// ---------- static files: only these, loaded once at startup (no path traversal is possible) ----------
const PUBLIC_FILES = [
  'index.html', 'style.css', 'app.js', 'pow.js', 'flag.svg', 'icon.svg', 'og.png', 'hand.webp',
  'site.webmanifest', 'robots.txt',
  // fonts are downloaded by setup.sh from the official package (checksum-verified), not stored in the repository
  'mukta-devanagari-400.woff2', 'mukta-devanagari-800.woff2', 'mukta-latin-400.woff2', 'mukta-latin-800.woff2',
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.pem': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const STATIC = new Map();
for (const name of PUBLIC_FILES) {
  if (!fs.existsSync(path.join(HERE, name))) continue;   // e.g. fonts not downloaded yet: the page falls back to system fonts
  let body = fs.readFileSync(path.join(HERE, name));
  if (name.endsWith('.html')) body = Buffer.from(body.toString('utf8').replaceAll('__DOMAIN__', CFG.domain).replaceAll('__SOURCE__', CFG.source));
  STATIC.set('/' + name, { body, type: TYPES[path.extname(name)], etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` });
}
STATIC.set('/', STATIC.get('/index.html'));
STATIC.set('/publickey.pem', { body: Buffer.from(KEYS.publicPem), type: TYPES['.pem'], etag: '"pk"' });

// ---------- HTTP ----------
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
    "connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function send(res, status, body, type = 'application/json', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': buf.length, ...extra });
  res.end(buf);
}

function readBody(req, limit = 512) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const noStore = { 'Cache-Control': 'no-store' };

    if (req.method === 'GET' && p === '/api/count') {
      return send(res, 200, snapshot, 'application/json', { 'Cache-Control': 'public, max-age=15' });
    }
    if (req.method === 'GET' && p === '/api/history') {
      // Public, aggregate-only: when each batch closed and how many taps it added. Lets anyone audit for spikes.
      return send(res, 200, { since: state.since, batchSeconds: CFG.batchSeconds, history: state.history },
        'application/json', { 'Cache-Control': 'public, max-age=60' });
    }
    if (req.method === 'GET' && p === '/api/challenge') {
      return send(res, 200, newChallenge(), 'application/json', noStore);
    }
    if (req.method === 'POST' && p === '/api/stand') {
      const ct = req.headers['content-type'] || '';
      if (!ct.startsWith('application/json')) return send(res, 415, { ok: false }, 'application/json', noStore);
      let data;
      try { data = JSON.parse(await readBody(req)); } catch { return send(res, 400, { ok: false }, 'application/json', noStore); }
      const result = verifySolution(data || {});
      if (result !== 'ok') return send(res, result === 'bad' ? 400 : 409, { ok: false, reason: result }, 'application/json', noStore);
      pending += 1; acceptedThisMinute += 1;
      return send(res, 200, { ok: true, nextBatchIn: CFG.batchSeconds }, 'application/json', noStore);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC.has(p)) {
      const f = STATIC.get(p);
      if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, SECURITY_HEADERS); return res.end(); }
      // page, script and styles are always re-checked (cheap, thanks to ETag) so updates reach everyone at once;
      // fonts and images rarely change and can be kept for a day
      const cache = /\.(woff2|png|svg|webp)$/.test(p) ? 'public, max-age=86400' : 'no-cache';
      return send(res, 200, req.method === 'HEAD' ? Buffer.alloc(0) : f.body, f.type, { ETag: f.etag, 'Cache-Control': cache });
    }
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch {
    if (!res.headersSent) send(res, 500, { ok: false });
  }
});

// Tight limits so slow or oversized requests can't tie the server up.
server.requestTimeout = 10_000;
server.headersTimeout = 8_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 40;
server.maxRequestsPerSocket = 100;

server.listen(CFG.port, CFG.host, () => {
  // The only thing ever printed: that the server started. No request is ever logged.
  console.log(`Janta ka Mantar counter on http://${CFG.host}:${CFG.port} (count ${state.count})`);
});

function shutdown() { flushBatch(); process.exit(0); }   // never lose pending taps on restart
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// On an unexpected error: save the count and exit cleanly; systemd restarts the server in a second.
// Deliberately logs nothing, since an error message could contain request data.
process.on('uncaughtException', () => { try { flushBatch(); } finally { process.exit(1); } });
