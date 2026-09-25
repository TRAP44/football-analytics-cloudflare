# QA Release Checklist — v6.116.0 RC140

## RC140 — Provider xG Semantic Quality Guard
- Проверить `npm test`, включая `test/xg-quality-rc140.test.js`: xG считается confidence-bearing только при полной валидной паре home/away и trusted statistics source.
- Partial/invalid/untrusted xG не должен участвовать в `smartInsights`, `liveAiCoach` и post-match xG evidence; остальные валидные match statistics продолжают работать.
- Match Center должен вернуть `xgQuality`, `availability.xg` и не отмечать `availability.statistics=true` при пустом `statistics.items`.
- UI должен явно показывать статус xG и отличать «подтверждён», «неполный», «отклонён» и «источник не прошёл guard».
- Release gate: Worker/client `6.116.0-rc140`, Match Center cache `v12-xg-quality-rc140`, health/smoke flag `xgSemanticQualityGuard`.
- Supabase: новых миграций для RC140 нет; существующая provenance-миграция `v6.19` остаётся обязательной для обновляемой production-базы.

Этот файл содержит только актуальный gate. Исторические RC-контракты проверяются regression-тестами и Git history.

## Перед merge/deploy

```bash
npm ci
npm test
npm run verify:release
npm run verify:worker
```

Все команды должны завершиться без ошибок.

## Версия и release contract

- `package.json` и `package-lock.json`: `6.116.0`.
- Worker и client: `6.116.0-rc140`.
- Release candidate: `RC140`.
- Production workflow запускается только после успешного Quality.
- Post-deploy smoke проверяет ту же версию и RC.

## Supabase

Для нового проекта используется только `supabase/baseline/supabase_baseline_v6_18.sql`.

Для существующей базы должны быть применены:
`supabase/migrations/supabase_migration_v6_9.sql`, `v6_10`, `v6_11`, `v6_11_1`, `v6_12`, `v6_13`, `v6_14`, `v6_15`, `v6_16`, `v6_17`, `v6_18`, `v6_18_1`, `v6_19`.

Проверить:
- RLS и закрытые backend-only таблицы не открыты для `anon/authenticated`;
- service-role ключ не попадает в клиент;
- `MONETIZATION_ENABLED=false`;
- `DEV_MODE=false`.

## RC138 — Lineup Semantic Reliability

- Непустой ответ `/fixtures/lineups` больше не считается качественным сигналом сам по себе: после нормализации он проходит единый `lineupQuality` guard.
- Неполный или дублированный XI получает `state=partial_data`, `available=false`, `semanticState=partial`; transport/source metadata сохраняется.
- Partial XI не входит в `availableSignals` и не увеличивает `completenessPreview`; в последние 90 минут provider reliability дополнительно ограничивает data-trust.
- Match Center публикует согласованные `dataFreshness.lineups`, `lineupsConfirmed` и `lineupsPartial`.
- Analysis cache: `v12-lineup-reliability`; model-input contract: `4.12.0-lineup-reliability`.
- Новых внешних API, секретов и Supabase DDL нет.
- Regression: `test/lineup-semantic-reliability-rc138.test.js`; post-deploy smoke требует `lineupSemanticReliability`.

## RC137 — Starting XI Quality Guard

- Стартовый состав считается подтверждённым только при наличии ровно 11 уникальных игроков в `startXI`; неполный или дублированный ответ провайдера остаётся состоянием `partial`.
- Единый модуль `src/lineup-quality.js` используется в Match Center и предматчевом AI-анализе, поэтому frontend, Telegram и Quality Gate получают одинаковый статус состава.
- Final-window gate больше не может считать ответ из 10 игроков подтверждённым и не выдаёт рабочий сигнал на основании неполного XI.
- Сверка травм/дисквалификаций RC134 сохраняется, но статус публикации состава отделён от его полноты.
- Match Center отдаёт `lineupQuality` и `availability.lineupsConfirmed`; UI явно показывает `Неполный состав X/11`.
- Analysis cache contract поднят до `v11-lineup-quality`, чтобы старые RC136 snapshots с прежней семантикой подтверждения не переиспользовались.
- Версия model-input contract: `4.11.0-lineup-quality`.
- Новых внешних API, секретов и Supabase DDL нет.
- Regression: `test/lineup-quality-rc137.test.js`; post-deploy smoke требует health-флаг `lineupQualityGuard`.

## RC136 — On-demand Player-role Hydration

- Предматчевый анализ сначала переиспользует `Team Intelligence cache v2`, как в RC135.
- Если у конкретной стороны есть реальные активные потери, но сезонной статистики игроков в Team Intelligence cache нет, выполняется точечная hydration только для этой команды.
- Для hydration используется существующий provider chain RC133: API-Football primary и уже настроенный football-data.org fallback; новый внешний сервис и новый secret не добавляются.
- Бесплатный/стандартный режим ограничен одной страницей `/players` на команду за анализ; expanded режим — максимум двумя. Общий helper по-прежнему жёстко ограничен тремя страницами.
- Hydration не запускается для команды без активных потерь и блокируется `freeQuotaHealthy` guard при низком остатке квоты.
- Результат хранится в отдельном shared cache `analysis:player-role:*:v1` на 6 часов и может быть использован как stale fallback при временной деградации провайдера.
- В `dataProvenance.playerRoleHydration` явно фиксируется источник: Team Intelligence cache, analysis cache, network hydration, stale cache или unavailable.
- Если роль уточнить нельзя, модель сохраняет нейтральный вес и явно добавляет риск о неполных сезонных данных.
- Версия model-input contract: `4.10.0-role-hydration`.
- Новых Supabase DDL и обязательных секретов нет.
- Regression: `test/player-role-hydration-rc136.test.js`.

## RC135 — Player-role Weighted Availability

- AI-анализ переиспользует уже сохранённый Team Intelligence cache v2 и не делает дополнительных `/players` запросов.
- Активные потери RC134 сопоставляются с сезонной статистикой игрока сначала по ID, затем только по однозначно нормализованному имени.
- Вес сезонной роли учитывает наблюдаемые старты, минуты и результативные действия, сжимается к нейтральному значению на малой выборке и жёстко ограничен диапазоном 0.85–1.60.
- Сомнительный статус по-прежнему уменьшает вклад вдвое; общий probability shift остаётся ограничен прежним максимумом.
- Если сезонной статистики в shared cache нет, модель сохраняет прежний нейтральный вес 1.0 и не делает вид, что знает значимость игрока.
- UI показывает словесную игровую нагрузку только для реально сопоставленных игроков; числовой «рейтинг качества игрока» не вводится.
- Версия model-input contract поднята до `4.9.0-player-role`, поэтому новые immutable prediction snapshots фиксируют новый метод.
- Новых внешних API, секретов и Supabase DDL нет.
- Regression: `test/player-role-availability-rc135.test.js`.
- Post-deploy smoke требует health-флаг `playerRoleAvailability`.

## RC134 — Structured Availability & Suspensions

- Fixture-level `/injuries` нормализуется единым модулем `src/availability.js`.
- Раздельные категории: травма, болезнь, дисквалификация, другая причина; сомнения отмечаются отдельным статусом.
- Повторные строки одного игрока дедуплицируются до одной активной записи.
- Если игрок уже присутствует в опубликованном стартовом составе или запасе, старая запись о потере исключается из активных потерь и сохраняется в `resolvedByLineup`.
- Match Center и AI-анализ используют один и тот же нормализованный результат.
- Сомнительный игрок даёт половинный вклад в уже существующую эвристику absence adjustment вместо полного confirmed-out веса.
- UI отдельно показывает травмы/болезни, дисквалификации и сомнения и не называет fixture-level injury feed «подтверждёнными отсутствиями».
- Исправлен RC133 cache regression: Match Comparison читает Team Intelligence cache `v2`.
- Новых внешних API, секретов и Supabase DDL нет.
- Regression: `test/structured-availability-rc134.test.js`.
- Post-deploy smoke требует health-флаг `structuredAvailability`.

## RC133 — Team Player Season Stats

- Вкладка команды «Статистика» получает сезонные показатели игроков без отдельного frontend-запроса.
- API-Football `/players` остаётся primary и обрабатывается с обязательным `paging.current / paging.total`.
- User-facing загрузка ограничена максимум тремя страницами и перед каждой дополнительной страницей повторно проверяет запас квоты.
- Полная и частичная выборка различаются явно; неполная pagination не выдаётся за полный состав.
- Нормализуются матчи, минуты, голы, ассисты, рейтинг, передачи, отборы, дуэли, дриблинг и карточки без искусственного player score.
- football-data.org `/scorers` подготовлен как опциональный fallback по существующему `FOOTBALL_DATA_TOKEN`; он явно помечается как частичный список бомбардиров, а не полный roster stats.
- Ошибка player endpoint не ломает уже рабочую сезонную статистику команды.
- Team Intelligence cache contract поднят до v2; новых таблиц Supabase и новых секретов нет.
- Regression: `test/team-player-stats-rc133.test.js`.
- Post-deploy smoke требует health-флаг `teamPlayerSeasonStats`.

## RC132 — OpenLigaDB Event Fallback

- API-Football остаётся основным источником live/finished событий матча.
- OpenLigaDB вызывается только если подтверждённый блок `events` пуст или основной запрос не дал пригодных событий.
- Fallback ограничен явно поддерживаемыми лигами OpenLigaDB и использует существующий distributed minute guard.
- Запрос OpenLigaDB сужается по команде; матч принимается только при совпадении обеих команд и kickoff в пределах безопасного окна.
- Из OpenLigaDB нормализуются только голы и их авторы/минуты; карточки, замены, статистика, составы и травмы не синтезируются.
- Неоднозначная сторона гола отбрасывается вместо догадки.
- Provider provenance сохраняется в `dataFreshness.events`; UI может отличить fallback от API-Football.
- Новых секретов и Supabase DDL нет.
- Regression: `test/openligadb-events-rc132.test.js`.
- Post-deploy smoke требует health-флаг `openLigaDbEventFallback`.

## RC131 — Match at a Glance

- В полном анализе есть единый блок «Матч за 15 секунд» перед детальными вкладками.
- Карточки показывают форму, дома/в гостях, таблицу, потери, стартовые составы, H2H, 1X2 и качество оценки.
- Блок переиспользует уже полученные `recentForm`, `comparison`, `lineupImpact`, `h2h`, `market` и provenance; новых API-вызовов не создаёт.
- При недоступных injuries интерфейс пишет «не подтверждены», а не превращает отсутствие данных в нулевые потери.
- При неполных составах показывается 0/2 или 1/2 подтверждений с пояснением статуса provider.
- Рынок отображает фактического provider после fallback.
- Карточки работают как быстрые переходы к соответствующим вкладкам подробного анализа.
- Мобильный layout сворачивается в одну колонку.
- Regression: `test/match-cockpit-rc131.test.js`.
- Match at a Glance включён в health contract.

## RC130 — Licensed Odds Fallback

- API-Football остаётся primary provider 1X2; резервный odds provider вызывается только после отсутствия пригодного нормализованного рынка.
- `THE_ODDS_API_KEY` опционален, server-side only и по умолчанию пуст; без него поведение production не меняется.
- Поддерживаются только явно сопоставленные competition → sport key; неизвестные турниры не угадываются.
- Fixture matching требует совпадения обеих команд и разумной близости kickoff; другой матч не принимается только из-за похожего времени.
- The Odds API запросы используют shared secondary-provider rate guard, single-flight, timeout и короткий cache TTL.
- 1X2 из резервного источника нормализуется в общий `market` contract; model/frontend не зависят от формата provider.
- Если raw odds существуют, но пригодного 1X2 нет, reliability metadata отмечает рынок как недоступный вместо ложного `available`.
- Снимки движения коэффициентов продолжают использовать существующий `odds_snapshots` и сохраняют provider/bookmaker provenance.
- Новая DDL-миграция не требуется: необходимые provenance-колонки уже добавлены в v6.19.
- Regression: `test/odds-fallback-rc130.test.js`.
- Licensed Odds Fallback отражён в health contract как `enabled` либо `available_when_configured`.

## RC129 — Persistent Data Provenance & Transport Resilience

- Supabase v6.19 расширяет существующие `analysis_cache`, `odds_snapshots` и `model_predictions`; новые предметные таблицы не создаются.
- Cache rows сохраняют `provider`, `source_updated_at`, `freshness_status` и `updated_at`.
- Odds snapshots сохраняют provider, число bookmaker samples и upstream timestamp.
- Immutable model snapshots сохраняют `data_provenance` и `model_inputs_version`.
- Schema drift guard отдельно проверяет все новые provenance-колонки.
- API-Football получает не более одного retry и только для `FOOTBALL_NETWORK`; 429/cooldown/configuration не ретраятся.
- Match Center корректно возвращает 404 при пустом fixture без обращения к helper полного AI.
- Provider xG из match statistics остаётся отдельным сигналом; внутренние expected goals модели не выдаются за фактический xG провайдера.
- Regression: `test/data-quality-rc129.test.js`.
- Persistent Data Provenance включён в health contract.

## RC128 — Multi-Provider Data Service & Provenance

- API-Football остаётся primary provider; резервный источник не заменяет рабочий primary без причины.
- Турнирные таблицы используют единый provider chain и нормализованный внутренний формат.
- OpenLigaDB разрешён только для явно поддерживаемых соревнований; provider IDs не выдаются за API-Football team IDs.
- football-data.org не вызывается без `FOOTBALL_DATA_TOKEN`; токен остаётся только в Worker secrets.
- OpenLigaDB и football-data.org проходят через distributed minute guard `claim_provider_request`.
- Fallback-таблица сохраняется на 30 минут, primary-таблица — на 6 часов; stale cache остаётся последним безопасным слоем.
- Mini App показывает provider attribution и data provenance; неизвестность источника не преобразуется в нулевые аналитические сигналы.
- RC128 не требует DDL: schema fingerprint остаётся `c2c22ec25aacfcf1b9938b0850cebf49`.
- Regression: `test/data-service-rc128.test.js`.

## RC127 — Production Hardening

- AI-квота списывается через atomic RPC `consume_analysis_quota`; два параллельных запроса не могут оба пройти последний слот. Hotfix v6.18.1 дополнительно создаёт минимальную строку `users` до `usage_daily`, закрывая FK-race первого анализа.
- Неуспешный свежий расчёт возвращает зарезервированный слот через `refund_analysis_quota`.
- API-Football получает distributed minute guard `claim_provider_request`, общий для Cloudflare isolates.
- Daily digest использует `claim_daily_digest → complete_daily_digest/release_daily_digest`, поэтому retry/parallel cron не отправляет дубли.
- Полный schema fingerprint `backend_schema_fingerprint` дополняет точечные compatibility probes. Ожидаемый fingerprint: `c2c22ec25aacfcf1b9938b0850cebf49`.
- `/health/live` проверяет только Worker liveness; `/health/ready` проверяет Supabase, schema fingerprint, backend ACL, Telegram config и свежие Supabase auth failures.
- Production smoke обязан пройти `/health/ready`; старый декларативный `ok=true` больше недостаточен.
- Supabase `HTTP 401/PGRST303` текущей release identity считается incident.
- Distributed analysis lock при ошибке coordination работает fail-closed и отдаёт stale cache/503 вместо параллельного дорогого compute.
- Telegram initData: admin-sensitive запросы — максимум 15 минут; mutations — 2 часа; read-only — до 24 часов.
- Backend RPC доступны только `service_role`; у service-role сняты ненужные `TRUNCATE/REFERENCES/TRIGGER`.
- Supabase schema: v6.18; regression: `test/production-hardening-rc127.test.js`.

## Исторические RC72–RC126

Детальные исторические release-контракты удалены из текущего checklist, чтобы не дублировать Git history и regression-тесты. Их поведение продолжает проверяться соответствующими файлами `test/*-rcXX.test.js`, а продуктовая сводка сохранена в `README_CLOUDFLARE_RU.md`.

## Критический regression-контур

Обязательно должны оставаться зелёными тесты:
- поиск и выбор матча;
- Telegram quick AI → Mini App handoff;
- freshness/recheck/delta;
- kickoff handoff;
- post-match review/return;
- AI track record;
- fixture deep-link + distributed lock;
- media publisher/control room;
- news conversion → smart fixture → impact delta → decision card;
- русская локализация и access/security contracts.

## Production smoke

`scripts/post-deploy-smoke.js` должен подтвердить:
- `/health/ready` возвращает `ok=true`, `status=ready`;
- `version = 6.103.0-rc127`;
- `releaseCandidate = RC127`;
- `devMode = false`;
- Supabase/PostgREST, schema fingerprint и backend security checks = `ok`;
- свежих Supabase auth failures текущей версии нет;
- `/health/supabase` не доступен публично;
- public status/manifest возвращают текущую версию.

## Ручная проверка Telegram / Mini App

1. Найти клуб и открыть основной матч.
2. Получить Quick AI в Telegram и открыть полный анализ без повторного списания.
3. Проверить freshness/recheck перед стартом.
4. Проверить корректный handoff после начала матча.
5. Открыть новость клуба → AI-проверку → News Impact Decision Card.
6. Убедиться, что профиль обычного пользователя не показывает админские controls.
7. Убедиться, что весь пользовательский и административный интерфейс остаётся русскоязычным.
