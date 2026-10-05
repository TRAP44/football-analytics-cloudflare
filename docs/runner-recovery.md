# CI and production runner recovery

MatchRadar separates primary CI, security, deployment and production observation
from the optional local diagnostic runner.

## Runner boundaries

- `Quality` runs on GitHub-hosted `ubuntu-latest`, including the isolated
  Supabase/Docker database integration gate.
- `CodeQL Security` and `Privileged Access Audit` run on GitHub-hosted
  `ubuntu-latest`.
- `Deploy Production` runs on GitHub-hosted `ubuntu-latest` and keeps the
  existing `production` environment, exact-main provenance guard, rollback
  preflight and post-deploy smoke verification.
- `External Production Monitor` remains on an independent GitHub-hosted runner
  and receives no production deployment credentials.
- `External Production Monitor Diagnostics` may use the self-hosted runner as
  a secondary diagnostic signal only. Losing that runner must not block
  Quality, security gates, deployment, rollback or primary availability checks.

## Local self-hosted runner outage

If the local runner is offline:

1. Do not bypass or alter required status checks.
2. Primary Quality, CodeQL, Privileged Access Audit, Deploy Production,
   rollback and External Production Monitor continue independently.
3. Treat missing self-hosted diagnostics only as reduced diagnostic depth.
4. Restore the local runner when convenient for secondary diagnostics; it is
   not a release prerequisite.

## GitHub-hosted execution outage

If GitHub-hosted Actions cannot execute a required gate:

1. Keep the release fail-closed; do not manufacture statuses or direct-push
   around release controls.
2. Keep the active production version unchanged.
3. Continue using available production health evidence for availability.
4. Re-run the exact affected commit after execution recovers.
5. Deploy only after the normal required gates pass.

## Verification contract

The topology is acceptable only when:

- no required Quality, CodeQL, Privileged Access Audit or Deploy Production job
  carries the `self-hosted` label;
- database integration still executes the real Supabase CLI, Docker and psql
  migration/concurrency checks;
- deployment still verifies current-main identity, merged-PR provenance,
  previous-known-good rollback target and post-deploy smoke;
- monitoring does not gain production secrets;
- self-hosted execution remains optional and diagnostic-only.

This document records the recovery policy for GitHub Issue #463.
