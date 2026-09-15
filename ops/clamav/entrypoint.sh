#!/bin/sh
# NyayaGrid ClamAV entrypoint. clamd is the supervised process.
# Do not exec tail — a dead scanner must take the machine down so Fly restarts it.
set -eu

if [ ! -d /run/clamav ]; then
  install -d -g clamav -m 775 -o clamav /run/clamav
fi
chown -R clamav:clamav /var/lib/clamav

apply_conf() {
  prefix="$1"
  file="$2"
  env | grep "^${prefix}" | while IFS="=" read -r KEY VALUE; do
    TRIMMED="${KEY#"${prefix}"}"
    if grep -q "^#${TRIMMED} " "$file"; then
      sed -i "s/^#${TRIMMED} .*/${TRIMMED} ${VALUE}/" "$file"
    else
      sed -i "\$ a\\${TRIMMED} ${VALUE}" "$file"
    fi
  done
}

apply_conf "CLAMD_CONF_" /etc/clamav/clamd.conf
apply_conf "FRESHCLAM_CONF_" /etc/clamav/freshclam.conf

# Fly 6PN is IPv6 (::). Fly TCP checks may probe IPv4. Listen on both.
if ! grep -q '^TCPAddr 0.0.0.0$' /etc/clamav/clamd.conf; then
  printf '\nTCPAddr 0.0.0.0\n' >> /etc/clamav/clamd.conf
fi
if ! grep -q '^TCPAddr ::$' /etc/clamav/clamd.conf; then
  printf '\nTCPAddr ::\n' >> /etc/clamav/clamd.conf
fi
if ! grep -q '^TCPSocket 3310$' /etc/clamav/clamd.conf; then
  printf '\nTCPSocket 3310\n' >> /etc/clamav/clamd.conf
fi

mkdir -p /run/lock
ln -f -s /run/lock /var/lock

if [ ! -f /var/lib/clamav/main.cvd ]; then
  echo "Updating initial database"
  sed -e 's|^\(TestDatabases \)|#\1|' \
    -e '$a TestDatabases no' \
    -e 's|^\(NotifyClamd \)|#\1|' \
    /etc/clamav/freshclam.conf > /tmp/freshclam_initial.conf
  freshclam --foreground --stdout --config-file=/tmp/freshclam_initial.conf
  rm /tmp/freshclam_initial.conf
fi

if [ "${CLAMAV_NO_FRESHCLAMD:-false}" != "true" ]; then
  echo "Starting Freshclamd"
  freshclam \
    --checks="${FRESHCLAM_CHECKS:-1}" \
    --daemon \
    --foreground \
    --stdout \
    --user=clamav &
fi

if [ -S /run/clamav/clamd.sock ]; then
  unlink /run/clamav/clamd.sock
fi
if [ -S /tmp/clamd.sock ]; then
  unlink /tmp/clamd.sock
fi

echo "Starting clamd in foreground (supervised)"
exec clamd --foreground
