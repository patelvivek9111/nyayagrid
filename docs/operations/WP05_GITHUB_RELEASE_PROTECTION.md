# WP-05 — GitHub release protection / CI approvals

**PRODUCTION_DEPLOYED:** NO  
This document configures *protection*, not production deployment.

## Required GitHub Environments

Configure in the GitHub repository **Settings → Environments**:

| Environment  | Required reviewers | Purpose                                                                 |
| ------------ | ------------------ | ----------------------------------------------------------------------- |
| `staging`    | ≥1 owner/approver  | Gates `Deploy staging (manual approval)` workflow                       |
| `production` | ≥2 reviewers (preferred) | Gates `Production release gate (approval only)` — **no deploy steps** |

Optional protections to enable on both environments:

- Wait timer (e.g. 5–15 minutes) before job proceeds after approval
- Deployment branches: restrict to release tags / protected branches only
- Environment secrets: never share staging secrets into `production`

## Workflows

| Workflow                              | File                                           | Deploys? |
| ------------------------------------- | ---------------------------------------------- | -------- |
| CI                                    | `.github/workflows/ci.yml`                     | No       |
| Deploy staging (manual approval)      | `.github/workflows/deploy-staging.yml`         | No auto-push; records staging approval |
| Production release gate (approval only) | `.github/workflows/deploy-production-gate.yml` | **Never** |
| Staging continuous monitor            | `.github/workflows/staging-continuous-monitor.yml` | No |

## Operator checklist (human — GitHub UI)

- [ ] Create Environment `staging` with required reviewers
- [ ] Create Environment `production` with required reviewers
- [ ] Confirm no workflow job runs `fly deploy` / `fly apps create` for production
- [ ] Confirm production Environment secrets are empty until a separately approved prod app exists
- [ ] Restrict who can `workflow_dispatch` production gate (repo admin / release role)

## What Environment approval means

Approving the **production** Environment job means reviewers acknowledge a proposed SHA for a *future* release conversation. It does **not**:

- Create a Fly production app
- Rotate production secrets
- Run Neon migrations
- Close WP-03E / WP-04 gates

## CI approval notes

- Default branch protection (required status checks) remains the primary merge gate.
- Do **not** merge WP-05 branches to `main` from this workstream without an explicit merge request.
- Continuous monitor schedule only runs after the workflow file exists on the default branch.
