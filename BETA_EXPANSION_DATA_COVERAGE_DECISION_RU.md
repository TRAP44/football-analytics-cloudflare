# Beta Expansion & Data Coverage Decision

Дата снимка: 2026-09-26  
Источник истины: текущий `main`, `closed_beta_v1`, существующий `ops_events` / Beta Dashboard.

## Статус входа в этап

Этот этап **не активируется автоматически** после deploy.

Предыдущий этап **Closed Beta Launch & Evidence-Based Optimization** считается завершённым только когда система видит достаточно реальных verified beta-данных и разрешает контролируемое расширение когорты.

На текущем production snapshot (проверка Supabase после merge gate):

- verified beta users: **0**;
- `closed_beta_v1` rows за последние 14 дней: **0**;
- verified beta feedback: **0**;
- подтверждённый provider quota probe: **0**;
- после merge commit `c8ad8c6b9f6ad492e59aec5d588025732b18a32b` client/beta telemetry не поступала; были только production-monitor события;
- за предыдущие 14 дней есть **45** `FOOTBALL_RATE_LIMIT_BODY` сигналов, но без verified coverage sample это ещё не основание менять provider.

Поэтому реальное расширение когорты сейчас запрещено.

## Fail-closed expansion gate

Решение использует только существующий privacy-safe beta-контур. Новый analytics pipeline не создаётся.

Важно: первоначальная закрытая когорта определена как Beta-01/Beta-02. Поэтому первый expansion gate требует 2 уникальных verified beta users, а не 5. Требование 5 пользователей до разрешения самого расширения создавало бы логический deadlock: стартовую когорту нельзя расширить, пока она уже не расширена.

Минимальная доказательная база перед расширением:

- не менее **2** verified beta users из исходной когорты Beta-01/Beta-02;
- не менее **7** принятых server-side beta session starts;
- не менее **2** полностью пройденных последовательных journeys;
- не менее **3** timing samples для search;
- не менее **3** timing samples для match open;
- не менее **3** timing samples для AI;
- не менее **10** data coverage samples;
- нет launch/runtime blockers;
- нет подтверждённых `BLOCKER`;
- нет подтверждённых `MAJOR`;
- beta ops sample не должен быть усечён лимитом выборки.

Для этого контура beta session start определяется как принятый сервером `closed_beta_v1 BOOT_OK` после server-side telemetry dedupe. Это не отдельная система аналитики.

Возможные решения:

- `collecting_verified_beta` — реальных данных ещё недостаточно;
- `hold` — есть blocker/major/runtime blocker или ненадёжная выборка;
- `expand_with_data_limitations` — core beta стабильна, но coverage подтверждает необходимость отдельно рассмотреть источник данных;
- `ready_to_expand` — доказательная база достаточна и серьёзных подтверждённых проблем нет.

Только последние два статуса означают, что предыдущий этап можно считать завершённым и что controlled beta expansion разрешён.

## Data Coverage Decision

Отслеживаются только уже существующие privacy-safe признаки:

- lineups;
- injuries / availability;
- statistics;
- xG;
- odds.

Решение по provider:

- меньше 10 coverage samples → `collect_more_coverage`;
- достаточная выборка без систематической проблемы → `keep_current_provider`;
- систематические provider/rate-limit сигналы либо повторяющийся дефицит нескольких типов данных вместе с feedback → `review_new_or_paid_provider`.

`review_new_or_paid_provider` не означает автоматическое подключение нового provider. Это только разрешение перейти к отдельной технической оценке источников.

## Что запрещено на этом этапе

- расширять beta при статусе `collecting_verified_beta` или `hold`;
- считать обычную/admin telemetry beta-данными;
- менять веса аналитической модели ради conversion/completion;
- добавлять football provider по единичному missing-data событию;
- скрывать `NEEDS_MORE_EVIDENCE` как будто проблема подтверждена;
- считать Beta Dashboard сам по себе доказательством завершения этапа.

## Текущее решение

Пока verified beta sample равен нулю:

**BETA HOLD — FIXES REQUIRED**

Следующее фактическое действие — получить реальные verified beta sessions от Beta-01/Beta-02. Для первого решения об expansion нужны оба verified пользователя, суммарно не менее 7 принятых `BOOT_OK`, минимум 2 полных journeys, по 3 timing samples для search/match/AI и не менее 10 coverage samples. После этого Dashboard автоматически пересчитает expansion gate и data coverage decision.
