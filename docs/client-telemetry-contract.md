# Client Telemetry Contract

This document defines the canonical storage/query contract for MatchRadar client telemetry used by production verification and performance profiling.

## Canonical storage shape

Client telemetry is stored in `public.ops_events` with:

- `event_type = 'client_telemetry'`
- `code = <UPPERCASE_EVENT_CODE>`

Therefore BOOT_OK is **not** stored as `event_type = 'BOOT_OK'`. The canonical selector is:

```sql
where event_type = 'client_telemetry'
  and code = 'BOOT_OK'
```

The same pattern applies to `PRODUCT_ACTION`, `ACTION_ERROR`, `NETWORK_RECOVERY`, `CLIENT_ERROR`, and `COMPATIBILITY_BLOCK`.

## BOOT_OK performance evidence

A performance sample is considered complete for the current profiling pass only when the BOOT_OK metadata contains:

- `deploySha`
- `viewportWidth`
- `bootMs`
- `moduleReadyMs`
- `navigationReadyMs`
- `feedMs`

Additional timings such as `manifestMs`, `identityMs`, `responseEndMs`, `domContentLoadedMs`, `firstContentfulPaintMs`, and `revealDelayMs` remain useful but are not required by the minimum evidence gate above.

## Zero-sample handling

A query returning zero canonical samples is **insufficient evidence**, not a successful/healthy measurement. Verification must not convert a zero-sample result into a pass.

Use `src/client-telemetry-contract.js` when constructing source-level verification logic. Its selector deliberately separates `event_type` from `code` and its evidence assessor returns `insufficient_evidence` for an empty sample set.

## Production evidence checkpoint — 2026-10-02

Using the canonical selector over the preceding 24 hours returned:

- 21 BOOT_OK rows with `event_type='client_telemetry' AND code='BOOT_OK'`;
- 0 rows with the incorrect `event_type='BOOT_OK'` selector;
- 4 BOOT_OK rows containing the complete minimum performance field set above.

This checkpoint is evidence for Issue #356; it is not a permanent performance baseline. Performance comparisons must still be scoped to the intended deploy SHA and viewport population.
