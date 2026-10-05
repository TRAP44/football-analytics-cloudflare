# CI and production runner recovery

MatchRadar does not depend on a single self-hosted runner for critical CI,
security, deployment, backup/restore, or production observation.

## Runner boundaries

The following workflows run on GitHub-hosted `ubuntu-latest`:

- Quality;
- CodeQL Security;
- Privileged Access Audit;
- Deploy Production;
- External Production Monitor;
- External Production Monitor Diagnostics;
- Backup Supabase and isolated restore drill.

The previous self-hosted WSL runner may remain available for ad-hoc/local work,
but it is not part of the required release path.

## Failure behavior

If a personal PC, WSL instance, or old self-hosted runner is offline:

1. Do not bypass Quality, security, provenance, or deployment verification.
2. GitHub-hosted checks must continue independently.
3. External Production Monitor remains the production availability signal.
4. Deploy Production must still verify exact current-main SHA and merged-PR provenance.
5. Backup/restore must continue to fail closed if production secrets or prerequisites are unavailable.
6. Do not re-introduce `runs-on: [self-hosted, ...]` into critical workflows without a reviewed redundancy design.

## GitHub-hosted prerequisites

- Node.js 22 is installed through `actions/setup-node`.
- Docker is supplied by the GitHub-hosted Linux runner for local Supabase jobs.
- Quality installs PostgreSQL client when `psql` is not already available.
- Supabase CLI and Wrangler stay version/pin controlled by repository workflows/package metadata.
- Production secrets remain in GitHub environments/repository secrets and are never written to source or logs.

## Verification contract

Runner-topology changes are acceptable only when:

- production monitoring remains independent of a developer workstation;
- critical PR checks can start without the self-hosted runner;
- security gates remain fail-closed;
- production deployment still verifies current-main revision and PR provenance;
- database integration continues to execute the fresh-install/upgrade contract;
- backup and restore verification remain encrypted and isolated;
- no secret is exposed while moving execution environments.

This document records the recovery and runner-independence policy for GitHub Issue #463.
