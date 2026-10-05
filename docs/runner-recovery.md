# CI and production runner recovery

MatchRadar separates primary CI, security, deployment and production observation
from the optional local diagnostic runner.

## Runner boundaries

- `Quality` runs on GitHub-hosted `ubuntu-latest`, including the isolated
  Supabase/Docker database integration gate.
- `CodeQL Security` and `Privileged Access Audit` run on GitHub-hosted
  `ubuntu-latest`.
- `Deploy Production` runs on GitHub-hosted `ubuntu-latest` and keeps the
  existing `production` environment, exact-main provenance guard, Cloudflare
  rollback preflight and post-deploy smoke verification.
- `External Production Monitor` runs independently on GitHub-hosted
  `ubuntu-latest` and does not receive production deployment secrets.
- `External Production Monitor Diagnostics` may use the self-hosted runner as
  a secondary diagnostic signal only. Its outage must not block Quality,
  security gates, deployment, rollback or the primary availability monitor.

## Self-hosted runner outage

If the local self-hosted runner is offline:

1. Do not bypass or alter any required status check.
2. Primary Quality, CodeQL, Privileged Access Audit, Deploy Production,
   rollback and External Production Monitor continue on GitHub-hosted runners.
3. Treat the missing diagnostic workflow as reduced diagnostic depth, not as an
   application outage and not as permission to skip a gate.
4. Restore the local runner only for optional secondary diagnostics. It is not a
   prerequisite for production release or production visibility.

## GitHub-hosted runner or Actions outage

If GitHub-hosted Actions cannot execute a required gate:

1. Keep the release fail-closed; do not manufacture statuses or direct-push
   around branch/release controls.
2. Keep the currently active production version unchanged.
3. Use the already-running production health endpoints and any available
   independent monitoring evidence to assess application availability.
4. Re-run the exact affected commit after Actions execution recovers.
5. Deploy only after the normal required gates pass.

## Verification contract

A runner-topology change is acceptable only when:

- a local runner outage leaves primary production monitoring operational;
- a local runner outage does not queue Quality, CodeQL, Privileged Access Audit
  or Deploy Production solely because of `self-hosted` labels;
- database integration still runs the real Supabase CLI/Docker concurrency and
  migration gates;
- production deployment still verifies the exact current-main revision, merged
  PR provenance, previous-known-good rollback target and post-deploy smoke;
- no production secret is added to public monitoring or diagnostic workflows;
- the self-hosted runner remains optional and cannot become a hidden required
  branch/release dependency.

This document records the recovery policy for GitHub Issue #463.
