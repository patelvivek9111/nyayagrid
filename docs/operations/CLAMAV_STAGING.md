# Staging ClamAV operations

Private malware scanner for NyayaGrid staging. Do not attach a public IP or HTTP service. Do not disable scanning. Do not mark failed scans clean.

## Identity

| Item | Value |
| --- | --- |
| Fly app | `nyayagrid-clamav-staging` |
| Region | `iad` |
| Process group | `app` (exactly one Launch machine) |
| Size | `shared-cpu-2x` / **4096 MB** |
| Listen | TCP **3310** on Fly 6PN only (`0.0.0.0` and `::`) |
| Private host | `nyayagrid-clamav-staging.internal` (set `CLAMAV_HOST` to this class of name; do not put the secret in git) |
| Image | `ops/clamav/Dockerfile` (`clamav/clamav:1.4` + NyayaGrid entrypoint) |
| Config | `fly.clamav.staging.toml` |

Intended topology after the 2026-09-11 handoff: **one** machine in process group `app`. Confirm with `fly machines list --app nyayagrid-clamav-staging`.

## Why this image exists

The official ClamAV container starts `clamd` in the background and then `exec tail -f /dev/null`. Fly can report the VM alive after `clamd` dies. NyayaGrid then fail-closes uploads (`malware_scan_failed`) while ops thinks the scanner is up.

NyayaGrid entrypoint starts `freshclam` in the background and **`exec clamd --foreground`**. `tini -s` supervises that process. When `clamd` exits, the machine exits. Restart policy `always` brings it back. There is no `tail` keep-alive.

PID 1 on Fly is still `/fly/init`. Supervised child is `/sbin/tini -s -- …entrypoint.sh` → `clamd --foreground`.

## Health check

Fly TCP check `clamd` on port **3310**, interval 15s, timeout 5s, grace 8m (signature load).

A running container is not healthy. The check must fail when `clamd` is dead or 3310 is not listening.

`fly checks list --app nyayagrid-clamav-staging` should show `clamd` **passing**. `0/1` or `the machine hasn't started` means do not treat the scanner as available.

## Unsafe path (do not use)

The original scanner was an **ungrouped** `fly machine run` VM. `fly deploy` only updates Launch/`app` machines, so deploying `fly.clamav.staging.toml` while the only scanner was ungrouped **created a second VM** and split `.internal` DNS.

Do not:

- `fly machine run` a second ClamAV alongside the Launch machine
- `fly deploy` without `--ha=false`
- `fly scale count` above 1
- leave an ungrouped scanner in the app

If `fly status` says machines are not part of Fly Launch, stop. Convert or destroy extras only after a replacement `app` machine is proven.

## Safe deploy

From the repo root, after `fly machines list` shows **exactly one** `app` machine:

```bash
fly deploy --config fly.clamav.staging.toml --app nyayagrid-clamav-staging --ha=false --yes --wait-timeout 12m
```

Then:

1. `fly machines list --app nyayagrid-clamav-staging` → one machine, group `app`, checks `1/1`
2. PING / clean / EICAR from the staging web machine (below)
3. Optional: one-file canary `npx tsx runner/staging-ui-e2e.ts --canary` in `benchmarks/nyaya-bench`

Do not deploy this app from a different toml or with HA enabled.

## Restart

```bash
fly machine restart <machine-id> --app nyayagrid-clamav-staging
```

Wait for checks `1/1` (signature load can take about a minute; grace is 8 minutes).

## Resize

Keep **4096 MB** unless a later measurement proves a lower floor is safe. `clamd` was OOM-killed at 2 GB.

```bash
fly machine update <machine-id> --app nyayagrid-clamav-staging --vm-size shared-cpu-2x --vm-memory 4096 -y
```

## Rollback

Known-good image after lifecycle hardening:

`registry.fly.io/nyayagrid-clamav-staging:deployment-01M28MKGNPKKZ7X7QM45TVG55X`

```bash
fly deploy --config fly.clamav.staging.toml --app nyayagrid-clamav-staging --image registry.fly.io/nyayagrid-clamav-staging:deployment-01M28MKGNPKKZ7X7QM45TVG55X --ha=false --yes --wait-timeout 12m
```

Do not roll back to the official `clamav/clamav` image with `tail -f /dev/null`.

## Verify clamd PING

From the **NyayaGrid staging web** machine (uses 6PN DNS and the app `CLAMAV_HOST`):

```bash
fly ssh sftp put scripts/staging-clamav-verify.cjs /tmp/staging-clamav-verify.cjs --app nyayagrid-staging
fly ssh console --app nyayagrid-staging --command "node /tmp/staging-clamav-verify.cjs"
```

Expect JSON with `ok: true`, `clamavHostClass: fly-internal`, `pingResponseClass: pong`, `clean: ok`, `eicar: detected`, `failClosed: refused`. The script must not print the host or addresses.

`CLAMAV_FIXTURE` must be unset. `MALWARE_SCANNER` must be `clamav`.

## Clean file / EICAR

The verify script above sends a synthetic clean buffer (expect `OK`) and the standard EICAR test string (expect `FOUND` / blocked). NyayaGrid maps scanner-unavailable to `malware_scan_failed` and never to `clean`.

Outage upload rehearsal (scanner must already be down):

```bash
npx tsx runner/staging-ui-e2e.ts --failclosed
```

from `benchmarks/nyaya-bench`. Expect `malware_scan_failed` / not `clean` / not indexed.

## If clamd is OOM-killed

1. `fly logs --app nyayagrid-clamav-staging` — look for OOM / `clamd` exit
2. Confirm size is still 4096 MB (`fly machines list`)
3. If someone scaled to 2 GB, restore 4096 MB **before** restarting
4. `fly machine restart <id> --app nyayagrid-clamav-staging`
5. Wait for TCP `1/1`, then PING / clean / EICAR
6. Do not work around OOM by disabling the scanner or marking uploads clean

## Failure injection (bounded)

With restart policy `always`, `killall clamd` on the scanner must:

- fail the TCP check (`0/1`)
- exit the machine (no `tail` keep-alive)
- let Fly restart it
- return `1/1` after signature load

Do not leave restart policy at `no` after a test. Restore `--restart always` and start the machine.

## NyayaGrid coupling

Staging web (`nyayagrid-staging`) uses `MALWARE_SCANNER=clamav` and a private `CLAMAV_HOST`. Uploads enqueue ingest; the pipeline fail-closes when `clamd` is unreachable. Files must not be indexed until a real clean scan.
