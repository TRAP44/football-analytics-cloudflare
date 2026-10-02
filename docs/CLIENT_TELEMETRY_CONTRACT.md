# Client telemetry contract

MatchRadar stores Mini App client telemetry in `public.ops_events` using one canonical envelope:

- `source = 'client'`
- `event_type = 'client_telemetry'`
- `code` is the upper-case client event name, for example `BOOT_OK`, `PRODUCT_ACTION`, `ACTION_ERROR`, or `OPERATION_TIMING`.

The event name is **not** stored in `event_type`. Performance and release checks must filter the envelope and the code together.

## Canonical BOOT_OK evidence query

```sql
select
  created_at,
  metadata->>'deploySha' as deploy_sha,
  metadata->>'viewportWidth' as viewport_width,
  metadata->>'bootMs' as boot_ms,
  metadata->>'moduleReadyMs' as module_ready_ms,
  metadata->>'navigationReadyMs' as navigation_ready_ms,
  metadata->>'firstContentfulPaintMs' as first_contentful_paint_ms,
  metadata->>'manifestMs' as manifest_ms,
  metadata->>'identityMs' as identity_ms,
  metadata->>'feedMs' as feed_ms,
  metadata->>'revealDelayMs' as reveal_delay_ms,
  metadata->>'networkMode' as network_mode
from public.ops_events
where source = 'client'
  and event_type = 'client_telemetry'
  and code = 'BOOT_OK'
  and metadata->>'deploySha' = '<DEPLOY_SHA>'
order by created_at;
```

A zero-row result is meaningful only after all three canonical filters are present and the deployment SHA is confirmed. Do not interpret a query against a different event envelope as evidence that no client boots occurred.

## BOOT_OK performance evidence

A BOOT_OK row is suitable for startup profiling when it has:

- release attribution: `metadata.deploySha`;
- viewport: `metadata.viewportWidth`;
- core startup timings: `bootMs`, `moduleReadyMs`, `navigationReadyMs`, `manifestMs`, `identityMs`, `feedMs`, and `revealDelayMs`.

Browser-navigation fields such as `responseEndMs`, `domContentLoadedMs`, and `firstContentfulPaintMs` are useful when available but are not required for the core evidence validator.

## Canonical code pairs

| Client event | ops_events event_type | ops_events code |
| --- | --- | --- |
| `boot_ok` | `client_telemetry` | `BOOT_OK` |
| `boot_recovery` | `client_telemetry` | `BOOT_RECOVERY` |
| `compatibility_block` | `client_telemetry` | `COMPATIBILITY_BLOCK` |
| `network_recovery` | `client_telemetry` | `NETWORK_RECOVERY` |
| `client_error` | `client_telemetry` | `CLIENT_ERROR` |
| `product_action` | `client_telemetry` | `PRODUCT_ACTION` |
| `action_error` | `client_telemetry` | `ACTION_ERROR` |
| `operation_timing` | `client_telemetry` | `OPERATION_TIMING` |
| `data_coverage` | `client_telemetry` | `DATA_COVERAGE` |

No additional user-identifying field is introduced by this contract. Release identity continues to be attached by `recordOpsEvent`.
