# Thin supervised ClamAV image for Fly. clamd is the main process (no tail keep-alive).
FROM clamav/clamav:1.4

USER root
COPY ops/clamav/entrypoint.sh /usr/local/bin/nyayagrid-clamav-entrypoint.sh
RUN chmod 0755 /usr/local/bin/nyayagrid-clamav-entrypoint.sh

# tini -s: reap zombies even though Fly /fly/init is PID 1.
ENTRYPOINT ["/sbin/tini", "-s", "--", "/usr/local/bin/nyayagrid-clamav-entrypoint.sh"]
