# जनता का मंतर / Janta ka Mantar

The digital Jantar Mantar. One question, one button, one counter,
for a free, fair and accountable Election Commission.

## Go live

1. **Domain:** jantakamantar.org (WHOIS privacy on). Spare: jantakamantar.com.
2. **Code:** this repository. The server copies itself from here, and any edit made here goes live within 5 minutes.
3. **Server:** at Hetzner Cloud, *Add server* → Germany, Ubuntu 24.04, smallest shared CPU plan, Backups on.
   Paste all of `cloud-config.yaml` into *Cloud config* (the domain and repository are already filled in).
4. **Connect the domain:** in the registrar's DNS settings, add **A** records for `@` and `www` pointing to the server's IPv4 address.
5. **Check:** after 10–15 minutes, open https://jantakamantar.org. The padlock appears by itself.

## What protects visitors

- No names, numbers, logins, cookies, analytics or third-party code. The server keeps one number.
- No logs: the app, the web server and the system all write nothing about visitors to disk.
- One tap per device, remembered only on the phone. A small puzzle the phone solves stops bots.
- The total updates in one-minute batches, so no tap can be linked to anyone.
- Every count is digitally signed (`/publickey.pem`), and `/api/history` shows each minute's total publicly.
  Check it from any computer: `node verify.mjs https://your-domain`

## What protects the site

- No database, no admin page, no login to break into. Zero third-party code packages.
- Firewall, SSH password logins off, automatic security updates, locked-down service.
- If a hosting or domain problem ever takes the site down, create a new server from the backup
  (or a fresh one with the same cloud config) and point a spare domain at it.

## Files

Everything sits in one folder. The page: `index.html`, `style.css`, `app.js`, `pow.js`, images and fonts.
The counter: `server.mjs` (Node.js, no dependencies). Server setup: `cloud-config.yaml`, `setup.sh` and the
service files. Tools: `verify.mjs` (check signed counts) and `make_images.py` (preview image, QR codes).

Run locally: `node server.mjs`, then open http://127.0.0.1:8787
Fonts: Mukta, SIL Open Font License (`FONT-LICENSE.txt`).
