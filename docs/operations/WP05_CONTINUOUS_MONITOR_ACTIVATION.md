# WP-05 continuous staging monitor — activation on `main`

## Purpose

GitHub Actions workflow `staging-continuous-monitor.yml` probes
`https://staging.nyayagrid.com/api/health/ready` every 5 minutes **independently**
of the Fly app process.

Scheduled runs **require** repository SMTP secrets and `MONITOR_NOTIFY=smtp`.
They fail clearly if secrets are missing — never claim healthy notification coverage with notify off.

## Required repository secrets (names only)

| Secret          | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `SMTP_HOST`     | Resend SMTP host (e.g. `smtp.resend.com`)      |
| `SMTP_PORT`     | Usually `587`                                  |
| `SMTP_USERNAME` | SMTP username                                  |
| `SMTP_PASSWORD` | SMTP password                                  |
| `EMAIL_FROM`    | Verified sender (e.g. `staging@nyayagrid.com`) |
| `OPS_ALERT_TO`  | Operator inbox                                 |

Configure via GitHub → Settings → Secrets and variables → Actions.
Do not commit values. Fly staging secrets are separate and are **not** automatically available to Actions.

## State persistence

- Path: `.monitor-state/staging-monitor-state.json` (gitignored)
- Restored via Actions cache `restore-keys: staging-monitor-state-`
- Saved under a unique key per run (cache keys are immutable)
- Evaluator enforces 2 consecutive ready failures before firing and cooldown on repeat pages; recovery always emits resolved

## After merge to `main`

1. Confirm secrets above are set.
2. Wait for a scheduled run **or** `workflow_dispatch` with notify=`smtp`.
3. Confirm Actions logs show `PROBE_HEALTHY` / transitions without secret material.
4. Only then claim live scheduler + notification coverage.

## Not claimed by merge alone

- Live scheduled executions (need post-merge observation)
- Production on-call / PagerDuty
- Automated acknowledgment
