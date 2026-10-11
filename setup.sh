#!/usr/bin/env bash
# Janta ka Mantar: installs and locks down a fresh Ubuntu 24.04 / Debian 12 server.
# Normally run automatically by cloud-config.yaml. To run by hand, as root:
#   DOMAIN=yourdomain.org REPO=https://github.com/you/janta-ka-mantar.git bash setup.sh
set -euo pipefail
: "${DOMAIN:?set DOMAIN}"; : "${REPO:?set REPO}"; SINCE="${SINCE:-2026-10-11}"
APP=/opt/janta
export DEBIAN_FRONTEND=noninteractive

# 1. Software: Node.js 22 LTS and Caddy (automatic HTTPS), from their official repositories
apt-get update -q
apt-get install -y -q curl git gnupg ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q && apt-get install -y -q nodejs caddy

# 2. Security updates install themselves; the server reboots at 4am IST if an update needs it
cat > /etc/apt/apt.conf.d/52janta <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "22:30";
CONF
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

# 3. Firewall: only web traffic and SSH
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# 4. No password logins over SSH (the provider's web console still works for emergencies)
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/90-janta.conf
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# 5. System logs are kept in memory only and vanish on reboot; nothing about visitors is written to disk
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=16M\n' > /etc/systemd/journald.conf.d/volatile.conf
systemctl restart systemd-journald

# 6. Settings for the app
mkdir -p /etc/janta
cat > /etc/janta/env <<CONF
SITE_DOMAIN=$DOMAIN
SOURCE_URL=${REPO%.git}
SINCE=$SINCE
DATA_DIR=/var/lib/janta
CONF

# 7. Fonts (Mukta, open licence) from the official package, checked against a known checksum
FONT_TGZ=/tmp/mukta.tgz
curl -fsSL https://registry.npmjs.org/@fontsource/mukta/-/mukta-5.3.0.tgz -o "$FONT_TGZ"
echo "9a699204ffbab1151e098a9d28b2ad28bf47aa26207a9d19b7737f4acb40dc0f  $FONT_TGZ" | sha256sum -c -
mkdir -p /tmp/mukta && tar -xzf "$FONT_TGZ" -C /tmp/mukta
for f in devanagari-400 devanagari-800 latin-400 latin-800; do
  cp "/tmp/mukta/package/files/mukta-$f-normal.woff2" "$APP/mukta-$f.woff2"
done
cp /tmp/mukta/package/LICENSE "$APP/FONT-LICENSE.txt"
rm -rf /tmp/mukta "$FONT_TGZ"

# 8. The counter, as a locked-down service
cp "$APP/janta.service" /etc/systemd/system/janta.service

# 9. Caddy: HTTPS in front of the counter, with every log switched off
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP/Caddyfile" > /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nStandardOutput=null\nStandardError=null\n' > /etc/systemd/system/caddy.service.d/quiet.conf

# 10. Self-updating: every 5 minutes, pull any change you make to the public code and restart
install -m 755 "$APP/janta-update" /usr/local/bin/janta-update
cp "$APP/janta-update.service" "$APP/janta-update.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now janta.service janta-update.timer
systemctl restart caddy
echo "Janta ka Mantar is installed for https://$DOMAIN"
