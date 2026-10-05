# CI and production runner recovery

MatchRadar deliberately separates **independent production observation** from the
self-hosted CI/deploy runner.

## Runner boundaries

- The primary `External Production Monitor` availability probe runs on GitHub-hosted `ubuntu-latest` and does not depend on the MatchRadar self-hosted runner, Docker, Supabase, Cloudflare deployment credentials, or local network/VPN state.
- Its failure-diagnostics job runs on the self-hosted runner as a secondary classification path; loss of that runner must not invalidate the primary external availability signal.
- `Quality`, `CodeQL Security`, `Privileged Access Audit`, and production
  deployment remain fail-closed when their required execution environment is
  unavailable.
- Database integration and production mutation must not be silently moved to a
  weaker fallback just to make a workflow green.

## Self-hosted runner outage

If the primary self-hosted runner is offline:

1. Do not bypass Quality, security, provenance, or deployment verification.
2. Keep production unchanged. A queued deployment is safer than an unverified
   deployment.
3. Use the independent External Production Monitor as the availability signal.
4. Restore the runner service and its required Node/Docker/Postgres tooling.
5. Re-run the affected checks from the same commit. Do not manufacture status
   checks or direct-push around the release flow.
6. Deploy only after the normal gates pass.

## Verification contract

A change to runner topology is acceptable only when:

- production monitoring continues without the self-hosted runner;
- no production secret is added to the monitoring job;
- CI/security gates remain fail-closed;
- production deployment still verifies the exact current-main revision and PR
  provenance;
- monitor incident creation/recovery remains functional.

