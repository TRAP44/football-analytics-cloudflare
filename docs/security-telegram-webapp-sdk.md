# Telegram Web App SDK loading decision

Status: accepted for the current MatchRadar Mini App architecture.

## Decision

Both the public Mini App and the admin surface load the Telegram Web App SDK directly from the official Telegram origin:

`https://telegram.org/js/telegram-web-app.js?63`

The project intentionally does **not** attach a static Subresource Integrity hash to this upstream script.

## Rationale

Telegram's official Mini Apps documentation instructs applications to load this script from `telegram.org` in the document `<head>`. The upstream file may be updated in place by Telegram. A fixed SRI hash would therefore turn a legitimate Telegram update into a production outage until MatchRadar shipped a matching hash.

Self-hosting or proxying a copied SDK would create a different operational risk: MatchRadar could silently fall behind the Telegram client/API contract, and every upstream update would require an explicit review, redistribution and release process. We are not adopting that maintenance burden for the current release line.

## Threat model and accepted risk

Direct loading means code from `telegram.org` executes in the Mini App origin. If the Telegram-hosted SDK or its delivery path were compromised, SRI would otherwise be a useful integrity boundary. We accept this residual supply-chain risk because the SDK is a platform runtime dependency and Telegram's supported integration model is direct loading.

This decision does not extend trust to arbitrary third-party script origins.

## Compensating controls

- CSP `script-src` is limited to `'self'` and `https://telegram.org`.
- No wildcard third-party script host is permitted.
- Both public and admin surfaces use the same exact SDK URL.
- Server-side Telegram authentication continues to validate trusted init data; client-side `initDataUnsafe` is not a trust boundary.
- A regression test fails if either surface changes the SDK origin, adds a static SRI attribute, or diverges from the shared loading contract.

## Revisit triggers

Re-evaluate this decision if any of the following becomes true:

1. Telegram publishes a versioned, immutable SDK artifact suitable for SRI.
2. Telegram publishes an official integrity/hash mechanism.
3. MatchRadar introduces an approved, automatically updated and reviewed first-party SDK mirror.
4. The threat model or administrative surface changes enough that direct third-party execution is no longer acceptable.

Do not add a fixed SRI hash to the mutable Telegram URL without revisiting this decision first.
