// Check that a published count really came from the Janta ka Mantar server.
// Usage: node verify.mjs https://your-domain   (or a saved count.json + publickey.pem)
import crypto from 'node:crypto';
const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const snap = await (await fetch(base + '/api/count')).json();
const pem = await (await fetch(base + '/publickey.pem')).text();
const msg = `janta-ka-mantar|${snap.count}|${snap.updated}|${snap.since}`;
const ok = crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(snap.sig, 'base64'));
console.log(ok ? `VALID: ${snap.count} as of ${new Date(snap.updated * 1000).toISOString()}` : 'INVALID SIGNATURE');
process.exit(ok ? 0 : 1);
