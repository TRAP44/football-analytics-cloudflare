# Controlled Beta Expansion & Provider Decision Validation

Дата снимка: 2026-09-26  
Источник истины: текущий `main`, `closed_beta_v1`, существующий `ops_events` / Beta Dashboard.

## Входной gate

Этап **Beta Expansion & Data Coverage Decision** не считается завершённым, пока `expansionDecision.status` реально не стал:

- `ready_to_expand`; либо
- `expand_with_data_limitations`.

На production snapshot перед этим изменением:

- verified beta users: **0**;
- verified `closed_beta_v1` events: **0**;
- coverage samples: **0**;
- за предыдущие 14 дней есть **45** `FOOTBALL_RATE_LIMIT_BODY`, но они не относятся к verified expanded beta и сами по себе не разрешают менять provider.

Поэтому фактическое решение сейчас: **BETA HOLD**.

## Controlled expansion

Новая telemetry-система не создаётся. Используется существующий privacy-safe beta-контур.

Расширение остаётся ручным и fail-closed:

- baseline: 2 verified beta users;
- wave 1: целевой размер 4 пользователя;
- wave 2: целевой размер 6 пользователей;
- размер одной предлагаемой волны: не более **+2** пользователей;
- код никогда сам не изменяет allowlist и не добавляет beta-пользователей.

Следующая волна разрешается только когда текущие назначенные пользователи реально проявились в verified beta telemetry и нет BLOCKER/MAJOR, quota pressure или evidence для review provider.

## Проверки после каждой волны

Dashboard использует уже существующие события и показывает:

- Mini App launch;
- search used / success / empty / timeout;
- match open;
- AI start / AI complete;
- full journey;
- повторный вход;
- latency search / match / AI / LIVE;
- action_error и client error;
- BLOCKER / MAJOR;
- provider rate-limit;
- daily/minute quota limit + remaining;
- Supabase;
- Telegram;
- production monitor;
- LIVE opens / latency / coverage.

## Provider validation

Отдельно продолжают оцениваться:

- lineups;
- injuries / availability;
- statistics;
- xG;
- odds;
- LIVE coverage.

Решение `review_new_or_paid_provider` может быть подтверждено только evidence, а не единичным missing-data событием. Сигналы:

- повторяющийся beta rate-limit;
- подтверждённое quota pressure;
- уже подтверждённый data coverage deficit;
- систематический LIVE deficit нескольких типов данных на достаточной выборке.

Платный тариф или новый provider автоматически не подключается.

Если после реальной расширенной beta provider стабилен, quota не под давлением и coverage достаточен, решение фиксируется как `keep_current_provider`.

Если после расширения подтверждается систематический дефицит данных, rate-limit или плохой LIVE coverage, фиксируется `review_new_or_paid_provider`, после чего нужен отдельный сравнительный review providers по качеству данных, турнирам, LIVE, lineups, injuries, xG, player statistics, odds, rate limits, цене, лицензии и коммерческому использованию.

## Итоговые статусы этапа

- **BETA READY FOR PUBLIC PRE-LAUNCH** — две небольшие expansion-волны реально наблюдались, runtime стабилен, есть достаточные journey/coverage/latency/LIVE evidence, provider подтверждён как пригодный.
- **BETA CONTINUE** — gate на расширение открыт, но ещё нужно закончить волны или накопить evidence.
- **DATA PROVIDER UPGRADE REQUIRED** — на реальной расширенной beta подтверждён provider review signal.
- **BETA HOLD** — initial expansion gate закрыт или есть BLOCKER/MAJOR/runtime incident.

## Ограничения

- AI weights не меняются из-за beta conversion.
- Новая analytics/telemetry система не добавляется.
- Allowlist автоматически не расширяется.
- Платный provider не покупается и не подключается без явного подтверждения владельца.
