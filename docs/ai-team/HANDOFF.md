# Журнал передачи работы

Здесь Claude и Codex оставляют друг другу записки: что сделано, какие решения приняты, что осталось. **Новые записи — сверху.** Перед началом задачи прочитай хотя бы 3–5 последних записей.

Формат:

```
## ГГГГ-ММ-ДД — Кто — Короткое название
PR: ссылка или ветка
Сделано: 1–3 пункта
Решения: что выбрано и почему (если было)
Осталось / внимание: что следующему важно знать
```

---

## 2026-10-16 — Claude — Готовый разбор: замеры и пакетные события роста (#923)
PR: ветка `claude/cached-analysis-latency`.
Сделано: baseline свежего main и 4 пары чередующихся последовательных прогонов на GitHub-стенде (real-database-http). Узкое место по операциям: фоновый `recordGrowthEvent` на каждый разбор делал `GET users` ради атрибуции и `POST growth_events`. Теперь оба пакетами (`src/supabase-call-batcher.js`: окно 2 мс, до 100, одна identity Supabase; каждый caller ждёт подтверждения; ошибка пакета → прежний индивидуальный вызов). REST на 1000 разборов 6013 → ~4040; все HTTP 200, evidence 10000/1000/1160, paidProfilePreserved. `start-real-database-http-load.js`: аннотации `real-db peak N`/`real-db evidence` в GitHub и режим `REAL_DB_STAND=native`. Таблица прогонов — `docs/CACHED_ANALYSIS_LATENCY_RU.md`.
Решения: p95 в среднем 5168 → 4449 мс, p50 4056 → 4199 мс; разброс машин GitHub больше эффекта — ускорение не заявлено. Нативный стенд облачной среды (2 vCPU) отдаёт 503 уже в baseline — как доказательство не используется.
Осталось / внимание: цель 2 с не достигнута. Следующее измеренное узкое место — три последовательных запроса ответа: pre-auth claim → account claim → чтение квоты (~0,7–1,1 с каждый на пике). Варианты: один RPC на два claim (миграция, только после «да» Сергея) или чтение квоты параллельно с account claim (без миграции). Worker dry-run локально не запустился (нет доступа к npm registry в этой сессии) — его выполняет CI Quality.

## 2026-10-15 — Claude — Бот: кнопки и сценарии (#922)
PR: [#927](https://github.com/TRAP44/football-analytics-cloudflare/pull/927), ветка `claude/bot-buttons-fixes`.
Сделано: `sendBotFavoriteTeams` — все избранные страницами по 10 (`favorite:page:N`, листание правит то же сообщение), «➕ Добавить команду» (`fav:add` → выбор клубов), в карточке клуба «☆ Убрать из избранного» (`favorite:remove:<id>`, `removeBotFavorite` от `callback.from.id`, повтор безопасен) и «‹ Мои команды»; кнопка новостей клуба убрана (старые `news:team` работают). `sendBotFixtureSection('squads')` читает `/api/match-center` (как итог) — без `botAnalyzeFixture` и без отметки AI-квоты. Ошибки разделов, быстрой AI-оценки и избранного — короткий русский текст, детали — `recordOpsEvent`. Новый `src/telegram-chat-markup.js`: обёртка `telegramApi` в worker заменяет web_app-кнопки в группах/каналах ссылкой `t.me/<бот>?start=…` (или убирает), личка без изменений. `botDigestView` — подтверждённое состояние подборки и одно действие; `digest:on/off` правит то же сообщение только после успешной записи, сбой — alert. `botAiVerdictText`/`shareAiLine` — без уверенности /100, качества данных %, судьи и пустых «—». Inline: нет ленты дня и ничего не найдено → «Поиск временно недоступен», `cache_time:0`.
Решения: без новых рассылок, миграций и прод-настроек; напоминание «за 30 мин» не добавлял — текст выбора клубов исправлен на то, что есть (матчи в «Моих командах» и живой счёт при включённых уведомлениях о голах). `public/` не менялся.
Ревью Codex исправлено: `botAiHandoffText` (основной ответ `sendBotFixtureMenu`, в т.ч. deep link) — без уверенности /100, неопределённости, качества данных % и «Свежесть: — · 0 мин»; остаётся только 🟠-предупреждение при `needsRecheck`. Inline: `botRemoteTeamMatches(...,{strict:true})` пробрасывает сбой/таймаут `apiFootball` и `loadSearchTeamMatches` и блок по бюджету источника → «Поиск временно недоступен», `cache_time:0`, без лишних запросов; бот-поиск в чате по-прежнему глотает ошибки.
Осталось / внимание: `sendDigestControls` больше не вызывается кнопкой «☀️ Утренняя подборка» (она открывает «Уведомления»); функция оставлена для совместимости. Следующая задача — #923 (скорость разбора).

## 2026-10-15 — Codex — Восстановление «Мои команды» после сбоя
PR: [PR #926](https://github.com/TRAP44/football-analytics-cloudflare/pull/926), ветка `codex/my-teams-load-recovery`.
Сделано: первый сбой `/api/favorites` больше не выглядит пустым избранным и не оставляет вечную загрузку. Короткая русская ошибка с «Повторить», без внутренних деталей; уже загруженный список сохраняется при сбое обновления. `loadFavorites` перерисовывает экран при начале и завершении запроса, включая ошибки; существующие revision guard и защита от параллельных запросов сохранены. Приглашение добавить команду скрыто до ответа и при ошибке. Ревизия ассетов и lazy imports → launch121, ожидания тестов синхронизированы.
Выбор: /start, inline, табло и чистая главная уже сделаны (#911, #913–920); #921/#922/#923 назначены Claude, открытый #925 код не пересекает. Небольшой локальный дефект мешал возвращающемуся болельщику открыть свои команды; исправление использует прежний API и компонент восстановления, без новой инфраструктуры.
Критерии / проверки: первый сбой → ошибка без onboarding; повтор → загрузка → список; успешный пустой ответ → onboarding; сбой обновления → сохранённый список с повтором; двойное нажатие не дублирует запрос, поздний ответ не затирает локальную мутацию. Новые четыре теста исполняют настоящую функцию loadFavorites и настоящий renderer. Node22 ci/check/lint, release582/582, полный набор4169/4169, focused24/24, review-tail, security scan/privileged, verify:release и Worker dry-run. Chromium: новый сценарий 320px в обеих темах, кнопка видна, горизонтального overflow нет; существующий bottom-nav-render-smoke 320–1280px и first-run прошёл.
Осталось / внимание: браузерная проверка с синтетическими данными и локальным Chromium, не реальный Telegram WebView. Восстановление ручное; список сохраняется только в текущей сессии, offline storage не добавлен. Получение/свежесть матчей и production не менялись. Слияние — Сергей, ревью — Claude.

## 2026-10-15 — Claude — LIVE-табло: надёжность (#921)
PR: [#925](https://github.com/TRAP44/football-analytics-cloudflare/pull/925), ветка `claude/scoreboard-reliability`.
Сделано: `src/favorite-scoreboard-job.js` переписан: снимок старше 10 мин или раньше показанного не применяется (итог — всегда, из итога назад в LIVE нельзя); состояния active/pending/blocked/done компактно (`m,h,a,s`, старый формат #919 читается); пачка новых табло сначала надёжно сохраняется как pending, таймаут → без повтора sendMessage, `scoreboardRecipientIds` отдаёт только active (pending получают обычные уведомления о голах); 4xx/429 → отметка снимается, 429 — пауза `scoreboard:pause:v1` до retry_after; курсор `scoreboard:discovery:v1` по `telegram_id`; порядок итоги → правки/новые поровну; лимит 600 сообщений и 45 с; одна ops-запись с причинами и хвостом. Стенд `scripts/scoreboard-harness.js`, замер `scripts/scoreboard-capacity-sim.js`, политика и замеры — `docs/LIVE_SCOREBOARD_RU.md`.
Решения: миграции нет; 600 не увеличен — на 10000 упираемся в размер JSON на матч (~0,5 МБ, ~35 МБ записи за первую раздачу, ~80 мин до последнего). Предложена таблица `scoreboard_deliveries` — отдельная подзадача, только после «да» Сергея.
Ревью Codex исправлено: перед правкой получатели заново проверяются (уведомления о голах + команда в избранном; отписался → табло done, проверка упала → правки отложены); курсор составной `(telegram_id, team_id)` — граница страницы не теряет вторую команду человека; дедлайн 45 с проверяется перед каждой отправкой в пачке, неотправленные отметки снимаются; свежесть — по фактическому времени запуска. Regression-тесты на все четыре.
Осталось / внимание: следующие задачи по #924 — #922 (кнопки бота), затем #923 (скорость разбора). Массовая доставка 10000 табло не решена — нужна таблица.

## 2026-10-15 — Claude — Бот: меню из 2 кнопок
PR: ветка `claude/bot-menu-two-buttons`.
Сделано: `footballBotKeyboard` — «⭐ Мои команды», «⚙️ Уведомления». «⚽ Матчи»/«🔴 LIVE» (web_app из #917) убраны: дублировали кнопку приложения рядом с полем ввода. Текст старых кнопок по-прежнему отвечает кнопкой в приложение (#917). /help обновлён.
Проверки: check/lint, release, полный набор (только bot-match-card — нет resvg).

## 2026-10-15 — Claude — Живое табло любимых команд
PR: ветка `claude/favorite-live-scoreboard`.
Сделано: `src/favorite-scoreboard-job.js` — задача `favorite_scoreboard` в scheduled-jobs после `in_play_timeline`. Берёт идущие (1H/HT/2H/ET/BT/P) и завершённые за 4 ч (FT/AET/PEN) матчи из кеша `provider-fixtures:<день>:v1` (вчерашний — в первые 4 ч UTC), болельщиков из `favorites` (`team_id in (...)`), фильтр `filterSmartNotificationRecipients(rows,'match.goal')`. Одна запись кеша `scoreboard:<fixture>:v1` с message_id каждого получателя: новое сообщение только для идущего матча, дальше `editMessageText` при изменении текста, после свистка — итог и `done`. 403/заблокировал бота — `blocked`, больше не пишем. Потолок 600 сообщений за запуск. Кнопка — `match:menu` (до конца) / `match:review` (итог). `FAVORITE_SCOREBOARD_ENABLED` (по умолчанию true) в `.env.example`.
Решения: без новых запросов к источнику и без миграций; авторы голов не показываются (в пакете матчей дня нет событий) — можно добавить отдельно.
Осталось / внимание: у кого идёт табло по матчу, отдельное уведомление о голе (`match.goal`) не отправляется (`loadScoreboardRecipients` в smart-notification-service). Лимит Telegram 429 — отметка снимается, запуск останавливается.
Проверки: check/lint/verify:release, release, review-tail, isolated-load, полный набор (только bot-match-card — нет resvg). Новый test/favorite-scoreboard-job.test.js.

## 2026-10-15 — Claude — Бот: выбор любимых команд после /start
PR: ветка `claude/bot-favorite-picker`.
Сделано: `sendFavoritePicker` / `pickStartFavorite` (`telegram-bot-orchestration-runtime.js`): 15 клубов (ID сверены с лентой матчей 15.10: Реал 541, Барселона 529, Ман Сити 50, Ман Юнайтед 33, Ливерпуль 40, Арсенал 42, Челси 49, Бавария 157, ПСЖ 85, Ювентус 496, Интер 505, Милан 489, Зенит 596, Спартак 558, ЦСКА 555), callback `fav:pick:<id>` только добавляет (идемпотентно, в dedupe как idempotent mutation) и перерисовывает клавиатуру; `fav:done` → `sendBotFavoriteTeams`. /start без deep link в личке и «⭐ Мои команды» при пустом избранном показывают выбор.
Решения: в избранное пишется название как в данных (латиницей), на кнопках — по-русски; логотип — канонический URL источника.
Проверки: check/lint/verify:release/security:privileged, release, полный набор (только bot-match-card — нет resvg). Новый test/bot-favorite-picker.test.js.

## 2026-10-15 — Claude — Бот: меню из 4 кнопок
PR: ветка `claude/bot-menu-cleanup`.
Сделано: `footballBotKeyboard` — «⚽ Матчи» и «🔴 LIVE» стали web_app-кнопками приложения (`{}` и `{filter:'live'}`), «⭐ Мои команды», «⚙️ Уведомления». «📰 Новости» и «💎 Тарифы» — в `REMOVED_MENU_LABELS`. Текст «⚽ Матчи»/«🔴 LIVE»/`/today`/`/live` из старой клавиатуры в личке — кнопка «Открыть матчи/LIVE» и новое меню; вне лички — прежний список. Справка /help обновлена. Код текстовых списков и новостей не удалён — на них ссылаются старые сообщения (кнопки «Обновить»).
Решения: Сергей 15.10 — убрать новости (плохой источник), тарифы (оплата выключена) и текстовые списки матчей. Дальше по порядку: выбор любимой команды после /start, затем живое табло.
Проверки: check/lint/verify:release, release, полный набор (только bot-match-card — нет resvg в песочнице).

## 2026-10-15 — Claude — Inline-поиск: свои команды, турниры, страны
PR: ветка `claude/inline-top-matches`.
Сделано: пустой запрос — матчи избранных команд (`getFavorites`), затем лента по важности; LIVE наверх только у `tier: elite` (в 17:50 наверх лезли Уганда/Киргизия). Запрос: команда (как в поиске бота), затем турнир/страна по `league`, `leagueShort`, `leagueOriginal`, `country` + алиасы «рпл», «апл», «лч», «ле», «лк», «серия а», «ла лига»; двухбуквенные — только точное совпадение короткого названия. Затем — ближайший матч команды у источника. До 10 результатов; страна у одноимённых лиг.
Проверки: check/lint, release, полный набор (только bot-match-card — нет resvg в песочнице).

## 2026-10-15 — Claude — Inline: главные матчи без низших лиг
PR: ветка `claude/inline-top-matches`.
Сделано: пустой inline-запрос больше не поднимает все LIVE наверх — порядок ленты (уже по важности), LIVE первыми только у `competition.tier === 'elite'`. В 17:50 первыми шли Al-Faisaly, Berane, Kataka, Bishkek City вместо Лиги Европы. В карточке и описании к лиге добавляется страна, если она не «Мир» и не входит в название.
Проверки: check/lint, release, полный набор (только bot-match-card — нет resvg в песочнице).

## 2026-10-15 — Claude — Inline: лента дня из последнего снимка
PR: [PR #915](https://github.com/TRAP44/football-analytics-cloudflare/pull/915), ветка `claude/inline-stale-feed`.
Сделано: `matches:<день>:v6-integrity` живёт в кэше 1 минуту и обновляется, когда ленту кто-то открывает, — после деплоя #913 inline почти всегда отвечал пустым списком. Теперь при пустом `getCache` берётся `getStaleCache` (последний снимок дня). Снимок старше 6 минут: LIVE показывается как «🔴 идёт сейчас» без минуты и счёта, а матч, начавшийся больше 2 ч 45 мин назад, — только временем начала; в пустом запросе такие не показываются. Тесты inline больше не зависят от текущей даты.
Проверки: check/lint/verify:release, release, полный набор 4131/4132 (только bot-match-card — нет resvg в песочнице).
Осталось / внимание: Сергей включил inline в BotFather 15.10 17:11; если клиент Telegram не показывает подсказку — перезапустить клиент (кеш сведений о боте).

## 2026-10-15 — Claude — «Поделиться матчем» в боте с реферальной ссылкой
PR: [PR #914](https://github.com/TRAP44/football-analytics-cloudflare/pull/914), ветка `claude/bot-share-match-referral`.
Сделано: `sendBotFixtureShareCard` / `fixtureShareCardText` (`publisher-runtime.js`) — карточка для пересылки: команды, «турнир, страна», время МСК (у начавшегося — «⏱ Начало: …», без минуты и счёта: кеш и пересланная копия устаревают) или «Матч завершён · 2:2», AI-вывод только для home/away/double_* (до матча), личная ссылка `fx<id>__social__match_share__telegram__r<код>` в тексте и две URL-кнопки; кнопка «🧠 Открыть самому» (web_app) убрана — в пересланном сообщении она не работает. Обработчик `match:share` отвечает на нажатие после отправки карточки («Перешлите карточку друзьям — ссылка в ней ваша»). «↗ Поделиться матчем» добавлена в `footballSearchHandoffKeyboard` (будущий матч из поиска). Зависимость `telegramFullAnalysisUrl` из publisher-runtime убрана.
Решения: в базе на 15.10 — 3 `referral_code_created` (из Профиля), 0 `share_created` из бота и 0 `referral_open`: цепочка атрибуции на сервере была готова, мешал UX карточки. Атрибуция и награды не менялись (growth_events + `grant_referral_rewards` из #868): награда только новому пользователю после первого разбора.
Проверки: Node 22 check/lint, release 582/582, полный набор — только bot-match-card (нет `@resvg/resvg-wasm` в песочнице, как на main). Новый тест `test/bot-share-match-referral.test.js`: ссылка с кодом поделившегося, только URL-кнопки, без ставочных рынков, LIVE/итог без устаревшего вывода, друг → тот же матч и приглашение за поделившимся, повтор/самоприглашение не засчитываются.
Ревью Codex: P1 — карточка бота в кеше живёт до 180 мин и после свистка может быть «не начался»: после назначенного начала предматчевый вывод не показываем, строка «⏱ Начало: …» (`kickoffPassed`, часы инжектируются `clock`); P2 — нажатие подтверждается сразу, до базы и Telegram («Готовлю карточку — перешлите её друзьям», без обещания «ссылка ваша» — реф-код может не создаться), иначе при медленном ответе нажатие истекало и давало дубли карточек. P1 (повтор) — минута и счёт идущего матча из кеша тоже могли устареть: в карточке их больше нет. Ветка перенесена на main после #913 (конфликт только в доске/журнале).
Осталось / внимание: inline-карточка (#913) и эта кнопка ведут на один и тот же разбор с реф-кодом автора; кампании разные (`inline_share` / `match_share`) — в аналитике видно, какой путь работает.

## 2026-10-15 — Claude — Бот: карточка матча в любом чате (inline)
PR: [PR #913](https://github.com/TRAP44/football-analytics-cloudflare/pull/913), ветка `claude/bot-inline-match-card`.
Сделано: обработка `inline_query` — `answerBotInlineQuery` в `telegram-search-runtime.js`: до 5 карточек-статей (команды, турнир, время МСК / LIVE со счётом / итог), проценты AI только из сохранённого разбора (`prematchAnalysisCacheKey`, три исхода 0–100, сумма ≈ 100) и только до старта; кнопка «🧠 Открыть AI-разбор» — ссылка `fixtureTelegramDeepLink` с реф-кодом автора (campaign `inline_share`). Пустой запрос — главные матчи дня (LIVE первыми, без завершённых и низших лиг); основные составы выше юниорских; «Реал»/«Милан» — через `topTeamSearchPlan`, затем поиск команды у источника (те же квоты и кеш, что у поиска в боте). Нет результатов — кнопка в бота. `cache_time` 120 с, `is_personal`; лимит 20 inline-запросов/10 с на пользователя. Подсказка в /help. Событие роста `inline_search`.
Решения: Сергей 15.10 — MatchRadar продукт для массы людей; выбраны 5 идей для бота и канала, inline первой, остальные 4 в «Бэклоге».
Проверки: Node 22 check/lint/verify:release/security:privileged/security:scan/isolated-load, release 582/582, review-tail, полный набор 4130/4131 (падает только bot-match-card — нет `@resvg/resvg-wasm` в песочнице, как и на main). Новый test/bot-inline-share.test.js.
Осталось / внимание: inline-режим включает Сергей в BotFather: `/setinline` → бот → подсказка «Команда или матч…». Без этого Telegram не присылает inline_query. Webhook без allowed_updates — inline_query придёт по умолчанию.

## 2026-10-15 — Claude — Бот без «3+ гола» и «обе забьют»
PR: [PR #911](https://github.com/TRAP44/football-analytics-cloudflare/pull/911) — отдельный коммит; #912 закрыт и влит в #911, чтобы не ловить конфликты доски после squash.
Сделано: `botAiVerdictText` (`telegram-bot-ui-runtime.js`) — строка «⚽ Ожидаемые голы: А x.x — y.y Б» вместо процентов 3+ голов и «обе забьют»; «Итог AI» (`telegram-bot-orchestration-runtime.js`) — без блока «Голы:» из `review.markets`.
Решения: сервер по-прежнему считает over25/btts и `review.markets` (админка, оценка модели), меняется только текст для пользователей.
Проверки: Node 22 check/lint, release, полный набор (только bot-match-card — нет `@resvg/resvg-wasm`). Два новых теста.

## 2026-10-15 — Claude — Главная без лишнего: компактная лента, первый экран
PR: [PR #911](https://github.com/TRAP44/football-analytics-cloudflare/pull/911), ветка `claude/compact-home-feed` (основана на #910).
Сделано: `matchCardHtml` — одна строка `.match-row` (время/LIVE+турнир, команды строками со счётом, метки 🔔/👁/AI, стрелка); вся строка — кнопка `.match-row-open` с data-fixture/center/history-analysis, обработчик `bindMatchRows` зовёт контроллеры без кнопки (они переписывают textContent), загрузка — классом `is-opening`. Избранное/напоминание/«Следить» — в разборе и центре матча. `first-run-guide.js`: подсказка скрыта, если есть история; `#homeHero.is-compact` (без слогана и радара) для вернувшихся, вместе с ним скрыт `.mr-manifesto`. Строка лимита/Pass в разборе — только при `features.monetizationEnabled`.
Решения: Сергей 15.10 — «визуально неплохо, убрать лишнее»; цвет и стиль не менялись. Обработчики `[data-watch-fixture]`/`[data-quick-reminder]` в `bindMatchActions` оставлены (их используют другие экраны).
Проверки: Node 22 check/lint, release 582/582, полный набор 4122/4123 (только bot-match-card — нет `@resvg/resvg-wasm`), `bottom-nav-render-smoke` пройден (320–1280px, светлая/тёмная). Тесты старой карточки переписаны под новый контракт. Ревизия → `6.120.0-launch120`.
Осталось / внимание: сливать после #910.

## 2026-10-15 — Claude — Mini App: главные матчи на виду, без ставочных рынков, целые проценты
PR: [PR #910](https://github.com/TRAP44/football-analytics-cloudflare/pull/910), ветка `claude/miniapp-quick-ux`.
Сделано: в ленте новая раскрытая секция «Главные матчи» (`featured`/`isTop`, не youth) сразу после LIVE — `homeMatchSections` в `home-match-priority.js`. Из разбора, формы команд, страницы команды и итога после матча убраны «3+ гола», «Забьют обе команды», «Забивали обе»; в тексте объяснения (`match-explanation-runtime.js`) — без процента 3+ голов. Исходы в разборе и оценка по ходу матча — целые проценты (`probability-display.js`, наибольший остаток, сумма 100).
Решения: Сергей 15.10 — «делай как считаешь нужным»; рынки убраны по его прежнему решению «никаких ставочных рынков». Модель и payload не менялись, over25/btts по-прежнему считаются для админки. AI-таймлайн оставлен с десятыми — там важны мелкие изменения.
Проверки: Node 22 check/lint, release 581/581, полный набор 4121/4122 (падает только test/bot-match-card.test.js — нет `@resvg/resvg-wasm` в песочнице, как и на main). Скриншоты ленты и разбора сняты локально с тестовыми данными. Ревизия ассетов → `6.120.0-launch119`.
Осталось / внимание: бот ещё показывает эти рынки в «Итог AI» — записано в «Идеи». PR основан на #909 (доска) — сначала слить #909.

## 2026-10-15 — Claude — UX-ревью Mini App: 7 задач в бэклог
PR: ветка `claude/miniapp-ux-backlog`.
Сделано: прошёл Mini App глазами пользователя (локально, тестовые матчи, без реальных логотипов и AI-текста) — главная, лента, разбор, профиль. 7 находок записаны в «Бэклог» на доске с оценкой времени. Код не менялся.
Решения: перегруженный разбор (повторы фактов/рисков, 7 вкладок) из списка убран — его уже закрыл #908. Пункт про «3+ гола / обе забьют» ждёт решения Сергея.
Осталось / внимание: приоритет задач в бэклоге расставляет Сергей.

## 2026-10-15 — Claude — Упрощённый штаб матча: 3 вкладки, открыты сразу
PR: [PR #908](https://github.com/TRAP44/football-analytics-cloudflare/pull/908), ветка `claude/simplify-match-hq`.
Сделано: «Подробные данные матча» больше не свёрнуты — сразу 3 вкладки: Главное (что важно перед матчем, голы 3+/обе забьют, судья строкой, «↻ Обновить разбор» только при needsRecheck или после перепроверки) · Составы (стартовые, кто не сыграет) · Форма (форма по очкам, последние матчи, место в таблице, очные встречи — пустой H2H пишет «нет данных», а не 0–0–0). Удалены из UI и кода: преданализ (полнота данных, отрыв в п.п., неопределённость, «Почему модель пришла…», сценарии, «Как голосуют источники»), «Сценарии матча», сетка «Матч за 15 секунд», вкладки Обзор/Сравнение/Модель/Контекст, паспорт и покрытие данных. «N п.п.» в серверных текстах показывается как «N%» (publicText), в AI-таймлайне — без «п.п.». Ревизия ассетов 6.120.0-launch118.
Решения: старые ссылки/состояние с вкладками overview/comparison/model/context/market открывают «Главное» (normalizeAnalysisTab). Сервер и payload не менялись. Тесты, проверявшие удалённые блоки, переписаны под новый контракт; test/provider-coverage-transparency-rc124.test.js удалён (тестировал только удалённый UI). verify-release проверяет 3 вкладки.
Проверки: Node 22 check/lint/verify:release, release 581/581, review-tail 206/206, полный набор 4117/4118 (падает только test/bot-match-card.test.js — нет `@resvg/resvg-wasm` в песочнице, как и на main), bottom-nav-render-smoke пройден с локальным Chromium.
Осталось / внимание: центр матча (LIVE) не трогал — идея в «Идеи / найдено по пути».

## 2026-10-15 — Claude — Название поставщика данных скрыто от пользователя
PR: ветка `claude/hide-provider-name`.
Сделано: в Mini App `hideProviderName` (и внутри `publicText`) заменяет «API-Football»/«API прогноз»/«Прогноз API» на «источник данных»/«внешний прогноз»; поправлены подписи источника таблиц/игроков/сезона, блок происхождения данных, пустое состояние даты, баннер лимита. На сервере: фактор «Прогноз API-Football указывает: …» удалён (противоречил итогу: указывал одну команду, а проценты — другое), имя сигнала apiPrediction → «Внешний прогноз», тексты warning/reason в таблице турнира, сезонной статистике, составах и ленте без названия поставщика. Ревизия ассетов 6.120.0-launch117.
Ревью Codex: регулярки без \b для кириллицы и без lookbehind (старые iOS WebView); тот же `hideProviderName` на сервере в `signal-wording.js` внутри `neutralReasonText` — закрывает риски/причины в боте, включая старые кеши; риск «API-Football не вернул процентный прогноз», предупреждение о прогнозе и тексты поиска переписаны.
Решения: админка и ops_events не тронуты — там название нужно для диагностики. В «Бэклог» первой строкой — упрощение штаба матча (скрины Сергея 15.10), ждёт «да» по составу вкладок.
Проверки: Node 22 npm ci/check/lint, release 581/581, полный набор — провал только `test/bot-match-card.test.js` (в песочнице нет `@resvg/resvg-wasm`, падает и на main). Новый тест test/provider-name-hidden.test.js.


## 2026-10-15 — Codex — Пакетная синхронизация профилей при первом входе
PR: [PR #906](https://github.com/TRAP44/football-analytics-cloudflare/pull/906), ветка `codex/analysis-user-write-batching`.
Сделано: profile-only batch до100/2мс, точная connection identity/snapshot, ожидание persistence до userSyncAt. Ошибка batch вызывает независимые individual writes. Telegram validation, квоты/оплата, singleflight/TTL сохранены. SQL harness проверяет обновление имени PRO-пользователя без изменения plan/subscription_until.
Замер: main #902 p95 ленты1926мс, пакеты772/933/860мс, REST10002→102–104. Все HTTP200/DB200–201; SQL users10000/history1000/events1160, paidProfilePreserved=true. Cached p95 не улучшился (3973→4728/4331/4903), цель2с не достигнута. Подробно docs/USER_PROFILE_LOAD_RU.md.
Проверки: Node22 npm ci/check/lint/security:privileged, release581/581, полный набор4146/4146, Worker dry-run; три настоящих DB ramp. #902 перенесён в Готово; открытый Claude #905 не пересекает код, только coordination docs.
CI: после переноса #905 выявлена гонка readiness — init PostgreSQL временно принимал Unix-socket SQL перед штатным restart. Обе локальные проверки теперь ждут TCP 127.0.0.1, доступный только у окончательного процесса.
Осталось / внимание: Node/PG не deployed Workers/hosted Nano; production capacity не подтверждена. Batch локален isolate; при отказе storage добавляется failed batch перед fallback. Public/SQL миграции не менялись.

## 2026-10-15 — Claude — «Перелом матча» удалён целиком
PR: [PR #905](https://github.com/TRAP44/football-analytics-cloudflare/pull/905), ветка `claude/remove-channel-swing-posts`.
Сделано: удалены `src/match-swing-job.js` и его тест, задание `match_swing` в `scheduled-jobs.js`, проводка в `worker.js`/`operational-orchestration-runtime.js`, конфиги `matchSwingEnabled`/`channelSwingPostEnabled` и переменные `MATCH_SWING_ENABLED`/`CHANNEL_SWING_POST_ENABLED` (wrangler, .env.example), упоминание в тексте настроек бота. В «Бэклог» записаны идеи 1, 2, 3, 5 по порядку.
Решения: Сергей 15.10 — сначала убрать посты в канал, затем «вообще удали, это не нужно» (в проде задача и так была выключена `MATCH_SWING_ENABLED=false`, замечание Codex). Кривая LIVE (`in_play_timeline`) и ручная тестовая публикация из админки остались. Бот больше ничего сам в канал не публикует.
Проверки: Node 22 npm ci/check/lint, release 581/581, полный набор — провал только `test/bot-match-card.test.js` (в песочнице нет `@resvg/resvg-wasm`, падает и на main).


## 2026-10-15 — Codex — Сокращение задержки готового разбора
PR: [PR #902](https://github.com/TRAP44/football-analytics-cloudflare/pull/902), ветка `codex/cached-analysis-latency`.
Сделано: cached-ответ ждёт history и свежую quota metadata параллельно, затем запускает прежние growth/referral фоновые операции. История группируется по точным Supabase URL/key, до 100 callers/2 мс, подтверждение upsert ожидается каждым; дубликаты берут newest viewed_at, сортируются conflict keys. Failures каждого caller идут в старый индивидуальный retry. Unknown identity не группируется. In-memory/getHistory, квоты/оплата/access и API shapes сохранены; public/SQL без изменений.
Замер: baseline p95 cached 5589 мс; только порядок — 5079; с batching три прогона 4268/4461/4502 мс (примерно 19–24% ниже). На те же 1000 cached requests DB REST 7000→6011, history REST 1000→11; все HTTP/DB 200/201. SQL подтвердил 10 000 users, 1000 history, 1160 full_ai events по четырём ступеням. Повтор поверх #901: p95 3949 мс, REST6012, SQL evidence полный. Подробно docs/CACHED_ANALYSIS_LATENCY_RU.md. REST timing по операциям добавлен в harness; SQL evidence событий теперь обязательный.
Проверки: Node 22 npm ci/check/lint, release 581/581, полный набор 4136/4136 после переноса #901, включая snapshot connection identity, security:privileged, Worker dry-run. Unit tests подтверждают параллельное ожидание, batch bounds/identity isolation/dedupe/ошибки и сохранённые индивидуальные retries.
Решения / внимание: 2с пока не достигнуты, production capacity не подтверждена. Отдельный реальный PostgreSQL/PostgREST с прогретым синтетическим L1, Node composition; Cloudflare CPU и hosted Nano RTT/IO не измерены. Не спрашивать тарифы/перенос tokens повторно: Workers Free, Supabase Free/Nano, API-Football PRO известны. #900 слит и перенесён в «Готово». Claude #901 слит и подтянут в ветку; открытый #899 не пересекается с кодом; координационные файлы меняются только своей строкой/записью.

## 2026-10-15 — Claude — Шапка и нижняя полоса Telegram в цвет фона Mini App
PR: [PR #904](https://github.com/TRAP44/football-analytics-cloudflare/pull/904), ветка `claude/telegram-chrome-color`.
Сделано: `applyInterfacePreferences` (public/modules/ui-preferences.js) берёт `--bg` с `body`, а не с `html`, и красит им шапку, фон и нижнюю полосу Telegram (`setBottomBarColor`, если клиент умеет). Ревизия ассетов launch115 → launch116. Тест в `test/interface-personalization.test.js`.
Решения: причина серо-синей шапки — premium-оболочка рисует фон на `body` (#04060a), а на `html` в теме «системная» остаётся `var(--tg-theme-bg-color)` (цвет самого Telegram). Цвет передаётся только в виде #RRGGBB, иначе — `themeParams.bg_color` или #04060a.
Проверки: Node 22 check/lint/release зелёные, полный набор — 1 провал `test/bot-match-card.test.js` (в песочнице npm не доустановил `@resvg/resvg-wasm`, к PR не относится; проверит CI).
Осталось / внимание: `initTelegramWebApp` при старте ставит `secondary_bg_color` до применения темы — возможен короткий «мигающий» кадр; если будет заметно, стоит сразу ставить цвет фона.


## 2026-10-15 — Claude — Задача 2 закрыта
PR: ветка `claude/board-drop-calc-time` (только документы).
Решения: Сергей 15.10 отменил этап «единое время расчёта (рассчитано в ЧЧ:ММ) в штабе/карточках» — «пользователь не должен видеть этого». Строка удалена из «Бэклога», #899 перенесён в «Готово», в docs/PREMATCH_PROVIDER_BUDGET_RU.md отмечено решение.
Осталось / внимание: не добавлять пользователю отметки времени расчёта вероятностей без нового решения Сергея. «Бэклог» сейчас пуст.


## 2026-10-15 — Claude — Задача 2: наблюдаемые матчи в приоритете
PR: [PR #899](https://github.com/TRAP44/football-analytics-cloudflare/pull/899), ветка `claude/prematch-reminder-priority`.
Сделано: фон предматчевых прогнозов (`src/prematch-prediction-job.js`) читает `match_reminders` (enabled) для подходящих матчей и ставит их первыми: напоминание → избранные → главные → интерес/время. Матч с напоминанием выбирается и вне главных лиг; окно 20 мин – 36 ч и фильтры молодёжных/низших лиг действуют. В журнал запуска добавлено `watched`. Описание — этап 3 в docs/PREMATCH_PROVIDER_BUDGET_RU.md.
Решения: «Следить» в Mini App хранится только на устройстве, поэтому серверный признак наблюдения — включённое напоминание. Чтение — `select fixture_id` по 200 id с пагинацией по fixture_id (как у избранных: популярный матч не скрывает остальные), максимум 1000 матчей, только Supabase; ошибка чтения не останавливает фон (прежний порядок). Бюджеты/perRun/потолки, миграции, public/ не менялись.
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4136/4137 — единственный провал `test/bot-match-card.test.js` и на чистом main: в песочнице не скачался `@resvg/resvg-wasm` (нет сети к npm), к PR не относится; проверит CI.
Осталось / внимание: единое время расчёта в штабе/допустимых карточках. Здоровье 15.10: ошибок вебхука нет, «Итоги дня» уходят (3/3); есть таймауты RPC Supabase у lease фоновых задач (claim/renew/complete, единицы за сутки).


## 2026-10-15 — Claude — Удалён пост «Матчи дня» в канале
PR: [PR #901](https://github.com/TRAP44/football-analytics-cloudflare/pull/901), ветка `claude/remove-channel-daily-post` — слит 15.10.
Сделано: по решению Сергея («уродский и не нужный, отключи и удали») удалены `src/channel-daily-post-job.js`, его тест, запуск в `scheduled-jobs.js` (окно 08:00 UTC), проводка в `worker.js`/`operational-orchestration-runtime.js`, конфиг `channelDailyPostEnabled` и переменная `CHANNEL_DAILY_POST_ENABLED` в `wrangler.jsonc`/`.env.example`. `bettingFree` перенесён в `match-swing-job.js` (нужен «Перелому матча»).
Решения: «Перелом матча», личные «Итоги дня» в боте и фильтр лиг канала `isChannelLeague` не менялись. Уже опубликованные посты в канале код не удаляет — их Сергей убирает вручную.
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4118/4119 — провал только `test/bot-match-card.test.js` (в песочнице не скачался `@resvg/resvg-wasm`, падает и на main).
Осталось / внимание: после merge и деплоя 16.10 в 11:00 МСК поста быть не должно; записи `CHANNEL_DAILY_POST_*` в ops_events прекратятся.


## 2026-10-15 — Codex — Настоящий PostgreSQL/PostgREST под HTTP-нагрузкой
PR: [PR #900](https://github.com/TRAP44/football-analytics-cloudflare/pull/900), ветка `codex/real-database-http-load`.
Сделано: локальный Docker стенд PostgreSQL 16.11 + PostgREST 16.4, pinned digests, UUID network/containers, loopback-only REST, БД без опубликованного порта. 39 настоящих fresh migrations, fingerprint совпадает с контрактом. 512 MiB/1 CPU/60 connections, REST pool 20. Настоящие HTTP-запросы к БД вместо заглушки; gateway только prefix/apikey-to-generated-JWT adapter. Standalone orchestrator запускает ramp 10→50→100→1000 и чистит только свои ресурсы; новый CI job без secrets.
Результат: большая ступень 10 000 GET + 1000 cached POST, все HTTP 200, реальные REST ответы только 200/201 (18 002), внешний fetch 0. p95 1761/5994 мс; SQL подтвердил 10 000 пользователей и 1000 строк истории. Предыдущий полный прогон 1818/6582 мс. Функциональные критерии пройдены, инженерная цель p95≤2с у разбора на пике не достигнута. Это измеренный результат, не обещание вместимости Cloudflare Free/hosted Nano. Payloads синтетические, L1 заранее прогрет, signed auth настоящая. Cold provider/платежи/Telegram/мобильные клиенты не нагружались.
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4142/4142, security:privileged. Реальный стек дважды прошёл полный ramp и SQL evidence; после каждого прогона контейнеры/сеть удалены.
Решения: тарифы зафиксированы — Workers Free, Supabase Free/Nano, API-Football PRO. Не запрашивать их снова и не просить переносить secrets из GitHub. #898 перенесён в «Готово»; аудит GitHub выполнился, CF после Billing Read доступен, Supabase project/compute 403; эти права для локального disposable стенда не нужны. Полный CLI PostgreSQL образ не поместился на диск, вместо него компактный реальный стек с той же схемой. В этом же PR getQuota объединяет свежие plan/expiry и usage_daily в один REST-запрос через существующий FK/UTC-фильтр. Никакого кеша оплаты; reserve/refund не менялись, UI/миграции не менялись.
Дополнительный прогон: 10 000 GET +1000 cached POST все 200, DB ошибки 0, операции на cached POST 8000→7000, всего 17 002. p95 2216/6497 мс: уменьшение DB запросов подтверждено, ускорение p95 — нет. Node 22 check/lint, release 580/580, полный набор 4144/4144 до дополнительного теста повторного чтения, Worker dry-run. Новый PostgREST registry ghcr.io с тем же digest; прежний public ECR дал quota error в первой попытке CI, повтор real-database-http уже зелёный.
Осталось / внимание: hosted Cloudflare/Nano, network RTT, shared CPU и много isolate не проверены, productionCapacityConfirmed=false. Оптимизация 8000 REST операций/1000 cached analyses (включая повторное чтение пользователя) нужна на основании полученной задержки; не кешировать оплату/квоты вслепую. Подробно docs/REAL_DATABASE_HTTP_LOAD_RU.md.


## 2026-10-15 — Codex — Обследование инфраструктуры через GitHub
PR: [PR #898](https://github.com/TRAP44/football-analytics-cloudflare/pull/898), ветка `codex/github-infrastructure-audit`.
Сделано: ручной Audit Infrastructure Capacity использует существующие production secrets CF token/account и Supabase access token + vars project ref. Только main, checkout main, contents:read, отдельный шаг secrets, 4 фиксированных GET, timeout/redirect:error, безопасный Summary + JSON artifact 7 дней. Дополнен точный privileged allowlist и требование production environment для нового workflow. Код приложения/public/SQL не менялись.
Наблюдения: отдельно запущена существующая Verify Production Supabase Migration на main; run https://github.com/TRAP44/football-analytics-cloudflare/actions/runs/38647289809 — success. Тем самым существующий секрет GitHub пригоден для чтения миграций, перенос в Codex не нужен. #897 опубликован, production SHA 9ad81e5, внешний монитор успешен, строка #897 перенесена в «Готово».
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4140/4140, security:privileged. Unit tests подтверждают фиксированные GET/destinations, исключение credentials/сырых bodies/billing details из отчёта, отказы/redirect/невалидные identifiers без утечек, отсутствие вывода Free при пустых подписках и main/production workflow guard.
CodeQL: исправлено js/incomplete-url-substring-sanitization в тесте аудитора — выбор ожидаемого credential сравнивает new URL(url).hostname с api.cloudflare.com, а не ищет подстроку в URL. Gate не ослаблен.
Решения / внимание: Cloudflare subscriptions endpoint требует Billing Read; deploy token может не иметь его. Не обещать полное обследование до запуска. Supabase compute variant не тариф организации, public endpoints не раскрывают organization plan/реальную вместимость. Missing/403 отражаются явно, неполный отчёт даёт failed job и сохраняет sanitized artifact. Даже полный отчёт не подтверждает throughput — productionCapacityConfirmed false. Ни новых tokens, ни переноса старых не требовать автоматически. Новый workflow запустить после merge в main; до merge GitHub его не регистрирует для dispatch. Реальная нагрузка/покупки/создание ресурсов не выполнялись. Документ docs/INFRASTRUCTURE_AUDIT_RU.md.


## 2026-10-15 — Codex — Массовый запуск: холодное чтение выключателей
PR: [PR #897](https://github.com/TRAP44/football-analytics-cloudflare/pull/897), ветка `codex/runtime-controls-singleflight`.
Сделано: обычные параллельные loadRuntimeControls объединяют незавершённое чтение Supabase в одном runtime/isolate. Административный force:true после текущего запроса всегда начинает новое чтение; принудительные обновления сериализованы, старый ответ не перезаписывает новый. TTL 30 секунд и fail-closed сохранены; после завершения flight удаляется. public/ и миграции не менялись.
Проверки: повтор full signed HTTP с имитированной Supabase: 10 000 GET + 1000 cached POST, все HTTP 200, пик 1000, чтения runtime_controls 999 → 1, всего DB 19 001 → 18 003. API-Football/Telegram запрещены. Node 22 npm ci/check/lint, release 580/580, полный набор 4135/4135, Worker dry-run. Регрессии 1000 холодных/истёкших чтений, точный TTL, отказ/пустая/невалидная строка и восстановление; два force во время старого запроса.
Решения / внимание: force может ждать один текущий запрос перед новым чтением; свежий кеш обычного клиента ведёт себя как прежде. Это один isolate, не доказательство реальной DB/Cloudflare throughput. Платежи/квоты/пользовательские записи не ослаблены, на 1000 cached POST ещё 8000 имитированных DB-операций.
Статус #896: слит владельцем, перенесён в «Готово». На первом чтении production manifest показывал ea9deec (#895), Quality нового main ещё выполнялся; merge не означает уже завершённый deploy.


## 2026-10-15 — Codex — Массовый запуск: изолированная нагрузка
PR: [PR #896](https://github.com/TRAP44/football-analytics-cloudflare/pull/896), ветка `codex/mass-launch-capacity`.
Сделано: объединены незавершённые одинаковые чтения prematch/LIVE вероятностей ленты; 1000 одновременных открытий теперь запускают одно чтение вместо 1000 в isolate. TTL/deadline/auth/quota/provider pacing сохранены. Добавлены signed HTTP full Worker harness (10 000 чтений, 1000 запросов готового разбора, пик 1000) и одноразовый PostgreSQL 16 RPC burst без сети. CI расширен до 1000 вызовов; короткие smoke-артефакты отделены от full. Soak исправлен: sleep уважает реальную задержку limiter вместо 1 мс.
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4132/4132, Worker dry-run. HTTP все 200, p95 921,93/966,56 мс; транспорт Supabase имитируется (20 мс), внешний API запрещён. Настоящий PostgreSQL: 282 допуска/718 отказов, Telegram 1 владелец/999 повторов, максимум 20 SQL-сессий. Gateway full: 32 сценария; 1000 разных PRO-запросов допускают 26, остальные ожидаемо ограничены короткой очередью. 120-секундный soak прошёл: 4600 вызовов, 250 ожидаемых отказов, очередь освобождена, retained heap +205 592 байта. Цикл отказов уплотнён для 60-секундного CI. Полная Supabase fresh/upgrade/restore локально не запускалась, проверяет CI.
Решения: production не нагружали; платёж уже проверен владельцем. Тарифы Workers/Supabase неизвестны. #895 опубликован (ea9deec), background jobs успешен. Подробный отчёт: docs/MASS_LAUNCH_CAPACITY_2026_10_15_RU.md.
Осталось / внимание: нельзя выдавать результат одного локального процесса за доказательство 1000 production users. До массового запуска подтвердить тарифы/CPU/DB pool, настоящий staging и multi-isolate throughput, долю кеша и API-бюджет; физических Telegram-клиентов не проверяли. Лимит PRO 7500 при фоне 1875 требует ≥94,375% кеша при 10 000 разборов по 10 запросов, до остальных задач. Следующая отдельная задача — уменьшить повторные runtime-control/пользовательские DB операции; в измерении 8000 имитированных DB-операций на 1000 готовых разборов. Собственная слитая строка #805 перенесена в «Готово»; чужие строки не менялись.


## 2026-10-14 — Codex — Задача 2: дополнительный расчёт по составам
PR: [PR #895](https://github.com/TRAP44/football-analytics-cloudflare/pull/895), ветка `codex/prematch-lineup-refresh`.
Сделано: второй этап существующего фонового расчёта. На пятиминутных тиках читается событие из общего свежего кеша составов; пересчёт только при двух подтверждённых XI (11 уникальных игроков, правильные команды, нет пересечения, источник API-Football ≤ 5 минут) в окне 20–90 минут до старта. Если события нет, после входа в ≤ 65 минут — одна сохраняемая попытка проверки lineups, максимум perRun; пустой/недоступный источник не опрашивается каждые пять минут. Позже принимаются свежие события общего кеша. На тиках вне первого интервала лента только из кеша.
Защита: старые бюджеты/выключатель #894 и приоритеты сохранены. После успеха — признак выполненного этапа в кеше разбора и отдельная запись на 3 дня; повтор проверяется под блокировкой матча. Первый разбор с тем же подтверждённым составом не пересчитывается. model_predictions по-прежнему FIRST + insert-ignore, первая вероятность неизменна, обновляется рабочий разбор штаба. Внутренний параметр доступен только системному входу, клиентские flags игнорируются. Событие закрепляет проверенные составы, без второго lineups-запроса внутри расчёта.
Хранилище: для критичных записей добавлен opt-in requireDurable — успех только после записи общего кеша; при ошибке нет ложной новой L1 записи. Обычный кеш сохраняет прежнее поведение. В ops_events добавлены lineupProbes/lineupRefreshed/lineupSkipped; пропуск источника останавливает запуск.
Исправление собственной #894: свежесть квоты/составов сверяется с фактическим временем, не с округлённым cron-слотом. Иначе новый ответ после задержки GitHub выглядел «из будущего». Добавлен регрессионный тест задержанного запуска.
Проверки: Node 22 npm ci/check/lint, release 580/580, полный набор 4129/4129, Worker dry-run. Изолированная настоящая композиция подтверждает новый XI, неизменность первой строки и повтор события без API; сценарий обновления с прогретым кешем — 4 запроса (две пустые сезонные статистики + игроки двух команд), повтор — 0. Начальные 9/10 и кеш 0 сохранены. Проверены частичный/дублирующий/чужой/устаревший XI, ограничения источника, durable failure, приоритет избранного, отсутствие пользовательских квот/истории, освобождение lock при отказе/повторе. Старые статические контракты кеша обновлены для дополнительной внутренней ветки, проверки квот не ослаблены.
Решения / внимание: без миграций и public/, полоски не возвращены. Реальных API/Supabase/Telegram запросов тестами не делали. Дополнительный расход не имеет фиксированного максимума на матч (кеш/состав/пагинация/retry), но ограничен фактическим суточным бюджетом. Малая группа — до 40 подходящих матчей; perRun общий для начального и дополнительного расчёта. Если единственная проверка прошла раньше публикации и общий кеш не обновился, дополнительный расчёт пропускается — не бесконечный опрос. Далее остаются наблюдаемые команды/единое время расчёта. #894 перенесён в «Готово». Ревью — Claude, merge — Сергей; инструкция docs/PREMATCH_PROVIDER_BUDGET_RU.md.


## 2026-10-14 — Codex — Задача 2: замер и резерв пользователей
PR: [PR #894](https://github.com/TRAP44/football-analytics-cloudflare/pull/894), ветка `codex/prematch-user-reserve`.
Сделано: первый этап усиления существующего фонового расчёта #831. Настоящий конвейер Worker изолированно измерен через подставной Supabase/ретранслятор: за 120 минут холодный расчёт 9 API-Football запросов, за 60 минут — 10, повтор из кеша — 0. Воспроизводимый скрипт scripts/measure-prematch-provider-cost.js и регрессионный тест, сеть закрыта для всех реальных хостов.
Защита: отдельный атомарный потолок запросов фона — 25% подтверждённого дневного лимита, не более 1875/7500. Проверка перед каждой фактической отправкой и retry, включая загрузку матчей дня. /status бесплатен и исключён. Фон останавливается при общем расходе ≥ 50% (консервативно считает и фон), неподтверждённой/старой дневной квоте, cooldown/critical или ошибке бюджетного хранилища. Пользовательский анализ не получает внутреннюю функцию допуска и не зависит от фонового потолка. Потолок 60 разборов сохранён.
Операции: PREMATCH_PREDICTIONS_ENABLED в переменных GitHub environment background-jobs переопределяет wrangler со следующего запуска без деплоя; отсутствующая переменная ничего не меняет, некорректная непустая безопасно отключает. Одна агрегированная ops_events запись реального запуска теперь включает пропуски бюджета/источника, причину и число зарезервированных запросов. Тики интервала/выключенной задачи тихие.
Решения: общая политика providerBudgetDecision используется также LIVE-кривой; строгая дневная защита включается только предматчевым фоном. UI/полоски вероятностей, схема Supabase, фон других задач и runtime_controls не менялись. #893 перенесён в «Готово», его production-деплой и фон успешны.
Проверки: Node 22, npm ci/check/lint; release 579/579, полный набор 4113/4113, Worker dry-run. Проверены отсутствие фонового допуска в пользовательских запросах, retry, отключение без деплоя, суточный сброс/меньшие тарифы/неизвестная квота, остановка внутри расчёта, одна запись журнала и изолированный замер реальной композиции.
Осталось / внимание: это первый этап, не вся задача 2. Далее отдельными PR — наблюдаемые команды в приоритете, пересчёт по объявленному составу с сохранением неизменного первого model_predictions, единое время расчёта в штабе/допустимых карточках. 9/10 — конкретные сценарии без судьи/опубликованного состава, не универсальный максимум. Дневная квота сверяется по последнему снимку, параллельный внешний расход виден после обновления; собственный потолок фона атомарен. Реальных API/Telegram запросов тестами не делали. Инструкция docs/PREMATCH_PROVIDER_BUDGET_RU.md; ревью — Claude, merge — Сергей.


## 2026-10-14 — Codex — Свежие матчи любимых клубов
PR: [PR #893](https://github.com/TRAP44/football-analytics-cloudflare/pull/893), ветка `codex/favorite-live-freshness`.
Сделано: кеш обнаружения матчей остаётся 120 минут; каждый ответ объединяет его со свежими (≤ 6 минут) общими снимками провайдера/ленты. По точному ID клуба добавляется отсутствующий LIVE, новые статус/минута/счёт заменяют прежние по времени снимка; отменённые удаляются. Нормализация сохраняет целочисленный счёт 0–99, неизвестное значение остаётся null; LIVE/итоговый счёт показан в ответе клуба.
Решения: никаких новых API-Football запросов. При отсутствии кеша свежий общий матч позволяет ответить без провайдера; иначе прежний next:8 с fallback last:6 (максимум 2 запроса). Защита квот/избранного сохранена. Просроченные/будущие/помеченные stale снимки не используются для обновления; старые карточки не получают новую отметку savedAt только из-за повторного чтения. public/ и расписание не менялись.
Проверки: Node 22, npm ci/check/lint, release 579/579, npm test 4103/4103, Worker dry-run. Регрессии: новый кеш будущих матчей не скрывает отсутствующий LIVE из чуть более раннего свежего снимка; потеря счёта при повторной нормализации, unknown≠0, новейший источник, отдельный LIVE, фильтр ID/дедупликация, квота без API, истечение/будущая дата/stale и новый кеш против старого снимка. #892 перенесён в «Готово».
Осталось / внимание: общий снимок обновляется существующим фоном, ответ не обещает поминутного провайдерного запроса. При отсутствии свежего снимка остаётся прежний кеш/fallback. Реальный Telegram не проверен: токена в среде нет. Ревью — Claude, merge — Сергей.



## 2026-10-14 — Codex — Аудит подачи остальных ответов бота
PR: [#892](https://github.com/TRAP44/football-analytics-cloudflare/pull/892), ветка `codex/bot-presentation-audit`.
Сделано: исправлено обрезание длинных строк PNG до 16 символов вместо 21 (кеш v3); кнопки поиска/клубных новостей сохраняют обе команды, обрезая каждую отдельно без разрыва UTF-16 пары. Сокращены пустые «Мои команды» и недоступные матчи клуба, длинные имена избранных получили многоточие. В матчах клуба LIVE с минутой, завершённые подписаны; текст статуса HTML-экранирован.
Проверки: Node 22, npm ci/check/lint, release 579/579, полный набор 4097/4097, Worker dry-run. Настоящий PNG с длинными названиями просмотрен; тесты проверяют границы строк, наличие двух имён в кнопках, emoji, неизменные callback, пустое избранное, LIVE/finished и HTML. Новости/пустые списки/ограничения источника покрыты проходящими существующими проверками.
Решения: не менялись квоты, права, число/сортировка матчей, расписание или API-запросы. public/ не менялся. Настоящий Telegram-клиент и отправка не проверялись: токена в среде нет. Отчёт docs/BOT_PRESENTATION_AUDIT_RU.md. Собственная #891 перенесена в «Готово».
Осталось / внимание: отдельно найдены кеш матчей клуба 120 минут и потеря счёта в normalizeBotFixtureCard; записано в «Идеи / найдено по пути», не исправлено в PR оформления. Следующий шаг данных — свежие LIVE любимых клубов из общих снимков. Ревью — Claude, merge — Сергей; после deploy проверить на телефоне.


## 2026-10-14 — Codex — Стабильный формат LIVE при изменении минуты
PR: [#891](https://github.com/TRAP44/football-analytics-cloudflare/pull/891), ветка `codex/stable-live-image-cards`.
Причина: PNG готовится в фоне каждые пять минут, а старый fingerprint содержал минуту всех восьми матчей. После 6′ → 9′ бот закономерно отвергал неизменившуюся по счёту картинку и показывал текст, что Сергей заметил на скриншотах.
Сделано: в PNG — счёт и LIVE/перерыв, актуальная минута только в кнопках/нижней подписи. Сигнатура сравнивает фактически нарисованные первые четыре матча, имена/ID, счёт, дату и видимый статус; нижние матчи не участвуют, поскольку их подпись формируется заново. Кеш v2 исключает старые PNG с минутами. Фон обновляет PNG старше 4 минут перед истечением TTL 6 минут, чтобы не возникала пауза между пятиминутными запусками.
Проверки: Node 22, npm ci/check/lint, release 578/578, полный набор 4091/4091. Регрессия отправки проверяет, что 63′ → 64′ остаётся sendPhoto с новой минутой в кнопке; 1:0 → 2:0 даёт актуальный текст. Проверены перерыв, завершение, порядок, истечение кеша и изменение нижней части списка.
Решения: TTL 6 минут и проверка счёта не ослаблены; backend не рисует изображения в запросе пользователя. Нет новых зависимостей/запросов провайдеру. public/ не менялся.
Осталось / внимание: ревью — Claude, merge — Сергей. #890 уже слит; ветка обновлена поверх main с сохранением удаления подзаголовка и обеих записей журнала. При изменении счёта/состава первых четырёх или отсутствии свежего PNG текст остаётся безопасным fallback.


## 2026-10-14 — Codex — Убрать подзаголовок списка матчей
PR: [#890](https://github.com/TRAP44/football-analytics-cloudflare/pull/890), ветка `codex/remove-bot-match-subtitle`.
Сделано: удалена строка «главные N из M · время МСК» под «Матчи сегодня» и аналогичный подзаголовок LIVE. Сразу после заголовка идут турниры и матчи. Время отдельных матчей и кнопки сохранены.
Проверки: Node 22, npm ci/check/lint, release 578/578, полный набор 4090/4090. Обновлены существующие проверки: отсутствие подзаголовка, прежнее время матчей, восемь кнопок плюс обновление; приоритет важного матча сохранён.
Решения: только оформление текстового списка по скриншоту Сергея; изображения/подписи, сортировка, лимиты, расписание и public/ не менялись. Собственные слитые строки #887/#889 перенесены в «Готово».
Осталось / внимание: ревью — Claude, merge — Сергей. Старые Telegram-сообщения не переписываются; после deployment нажать «Матчи» или «Обновить».


## 2026-10-14 — Codex — Картинки матчей без Telegram Premium
PR: [#889](https://github.com/TRAP44/football-analytics-cloudflare/pull/889), ветка `codex/bot-match-image-cards`.
Сделано: одно изображение с четырьмя главными матчами и настоящими гербами; в подписи остальные матчи без дублей, прежние кнопки для полного списка до восьми. В LIVE счёт/минута, в upcoming время МСК. Подготовка только в GitHub Node-фоне, в cron lease; Worker читает кеш и отправляет multipart sendPhoto, не рисует PNG.
CodeQL: тест отсутствия script-тега проверяет оба регистра (/i); проверка не ослаблена, реальное экранирование остаётся прежним.
Проверки: Node 22, npm ci/check/lint, release 578/578, полный набор 4090/4090, Worker dry-run, security/dependencies/privileged. Фоновый workflow устанавливает locked production dependency с --ignore-scripts; этот режим установки проверен отдельно. Реальный PNG просмотрен с гербами Arsenal/Chelsea/Liverpool/Manchester City, кириллицей и демонстрационными данными. Локальные тесты проверяют кеш/свежесть/сигнатуры и доставку с подставными интеграциями, реальным пользователям не отправлялось.
Решения: Сергей сообщил, что Premium и emoji set нет, и выбрал картинки. Подготовка не добавляет запросов API-Football, только ограниченные чтения логотипов. Рендерер/WASM/шрифт не входят в Worker. Совпадение счёта/минуты обязательно; иначе текст. Timeout/429 не повторяются. public/ не менялся.
Осталось / внимание: ревью — Claude, merge — Сергей; затем deployment и Node background job с новым кодом/свежим снимком. #888 с custom emoji закрыт без merge и заменён этим подходом, Premium-функция не подключена. Инструкция docs/BOT_MATCH_CARDS_RU.md. Токена Telegram в среде нет, реальная отправка/отображение требуют проверки владельцем после deploy.


## 2026-10-14 — Codex — Компактная утренняя подборка бота
PR: [#887](https://github.com/TRAP44/football-analytics-cloudflare/pull/887), ветка `codex/morning-news-style`.
Сделано: до трёх уникальных новостей, заголовки-ссылки, цветные emoji для распознанных команд, короткая подпись домена; одна кнопка «Все новости». Убраны повторные категории, оценки влияния/доверия и инструкция под сообщением. Страницы со ставками/прогнозами/превью отбрасываются до ограничения количества; кеш утра v3. Пустая подборка не отправляется.
Проверки: Node 22, npm ci, check/lint; release 578/578, полный набор 4081/4081. Тесты доставки используют подставные интеграции: Telegram-сообщения пользователям не отправлялись.
Решения: заголовок источника сохраняется без выдуманного перевода; цветные символы обозначают команду, а не заменяют её герб. Расписание, подписки и защита от повторной доставки не менялись. public/ не менялся.
Осталось / внимание: ревью — Claude, merge — Сергей. Для «Матчи» и LIVE можно использовать те же обычные emoji; их шаблоны в этом PR не менялись.

## 2026-10-14 — Codex — CodeQL: версия модулей для smoke
PR: [#886](https://github.com/TRAP44/football-analytics-cloudflare/pull/886), ветка `codex/validate-smoke-asset-revision`.
Причина: CodeQL main #38556879915 отметил js/file-access-to-http после передачи строки версии из HTML в браузерный import.
Сделано: URL проверки использует статическую FRONTEND_ASSET_REVISION из app-runtime.js; метаданные HTML только сверяются с ней. Содержимое файла больше не передаётся в browser/CDP. Версионированные импорты сохранены, проверки и rollback не отключались.
Осталось: пройти CI, затем merge Сергея и автоматический деплой launch115.

## 2026-10-14 — Codex — Исправление проверки деплоя launch115
PR: [#885](https://github.com/TRAP44/football-analytics-cloudflare/pull/885), ветка `codex/fix-deploy-ui-smoke`.
Причина: Deploy Production #38554458827 откатил #884 на launch114, поскольку новые браузерные сценарии импортировали компоненты без ?v=, в отличие от приложения. Старый неизменно кешируемый модуль мог не содержать ai-extra-details.
Сделано: smoke импортирует match-center-view и match-observation с EXPECTED_ASSET_REVISION. Проверки и rollback не ослаблены; public/ не менялся.
Проверки: check/lint и браузерный smoke 320–1280 px прошли. Воспроизведено на локальном сервере, который возвращает реальный старый компонент по неверсионированному URL: старая проверка падает с тем же AI details must start collapsed, исправленная проходит.
Осталось: merge — Сергей, затем автоматический повторный деплой всей launch115.

## 2026-10-14 — Codex — Второй этап очистки UI: девять пунктов аудита
PR: [#884](https://github.com/TRAP44/football-analytics-cloudflare/pull/884), ветка `codex/ui-cleanup-stage-two`.
Сделано:
- Убраны технические оценки уверенности/качества из сценариев, карточка «Качество оценки» и остаточный индикатор уверенности в шапке. Вероятности исходов сохранены.
- Во время LIVE предматчевые проценты больше не дублируют текущую оценку в верхней карточке; сохранённый разбор остаётся доступен по кнопке.
- Во вкладке AI история, графики, LIVE-пояснения и подробные инсайты собраны под одной раскрываемой строкой «Подробнее о матче». «О данных» в обзоре скрывает подробности источника.
- Единые действия: «Открыть матч», «Разобрать с AI», «Открыть разбор» для уже сохранённого результата. Наблюдение — короткие кнопки и пояснение по ⓘ. В обзоре потерь только числа, детали в «Составах». Увеличены тарифные подписи, убран «Выбор радара». Ассеты launch115.
Проверки: Node 22, check/lint, release-critical, полный набор 4076/4076, verify:release, security scan/privileged; браузерный smoke 320–1280 px проверяет реальный renderer с раскрытием/сворачиванием блока и отсутствием горизонтального переполнения.
Решения: серверные функции, вероятности, квоты и права не менялись. Разбор по кнопке по-прежнему может расходовать лимит, просмотр сохранённого результата — нет.
Осталось / внимание: ревью — Claude, merge — Сергей.

## 2026-10-14 — Codex — Убрать повторы на экране AI матча
PR: [#883](https://github.com/TRAP44/football-analytics-cloudflare/pull/883), ветка `codex/match-screen-dedup`.
Дополнение Сергея: по окончательному решению строка о задержке/кеше/времени обновления полностью удалена из ленты. Убраны технические пояснения о кешировании таблиц и загрузке профиля игрока.
Дополнение Сергея: удалён бейдж «Уверенность AI /100 / Данные: Ограниченные данные» и аналогичные оценки уверенности в шапке штаба, истории, Radar и тексте шаринга; предупреждения об устаревших данных сохранены.
Дополнение Сергея: полосы вероятностей удалены из всех карточек ленты и «Главного матча»; сохранены внутри штаба.
Дополнение Сергея: убрана вторая одинаковая сводка «Текущая картина»; подробности скрыты до нажатия, кнопка на всю ширину с янтарной рамкой «Подробнее о матче», повторное нажатие сворачивает. Методология раскрывается отдельно.
Дополнение Сергея: исправлен контраст процентов в LIVE и соседних сводках (янтарный текст на тёмной подложке); повторный блок «Что смотреть дальше» удалён.
Дополнение Сергея: блок «Честность модели» удалён целиком, включая стили, кнопку и загрузку протокола при открытии штаба.
Сделано: одна точка показывает только одну оценку; история скрыта до двух точек и содержит только предыдущие оценки. Убраны повторные подписи «Обновление модели», техническая шапка AI TIMELINE и дублирующая методология. Пустой LIVE-график не выводится отдельной панелью, компактный блок не рисует второй график в LIVE/finished. Сохраняются предупреждения об устаревших данных и отсутствие выдуманных графиков. Ассеты launch114.
Проверки: release прошёл; после обновления поверх #880/#881 полный набор 4076/4076 прошёл. Регрессии проверяют отсутствие удалённых пользовательских надписей.
Осталось / внимание: ревью — Claude, merge — Сергей. Изменения ограничены блоками истории и графиков, остальные содержательные разделы не удалялись без отдельного визуального замечания.

## 2026-10-13 — Claude — Бот: чистые новости
PR: ветка `claude/bot-news-clean`
Сделано: `compactNewsFeedText` отбрасывает прогнозы/ставки/превью (`NEWS_PREVIEW_TITLE_RE`) и срезает хвост «| Источник» у заголовков (`cleanNewsTitle`); принимает `options.title`. `sendFavoriteTeamNews` теперь шлёт тот же компактный вид («📰 Новости: <команда>») с кнопками «⚽ A — B» (ближайший матч), «🔄 Обновить», «📰 Все новости» — без «Источник N» и кнопок команд. Запрос общей ленты без «lineups», `maxResults` 10 (команды — 8), чтобы после фильтра оставалось 5.
Решения: Сергей 13.10 — новости «выглядят ужасно»; ставок в MatchRadar нет, поэтому прогнозные страницы не показываем.
Осталось / внимание: `newsFeedText` и `newsConversionKeyboard` больше не используются в боте, но оставлены (контракт rc69).
## 2026-10-14 — Codex — Исправление ревью #880 по разрешению Сергея
Сделано: до итоговой сортировки больше не отбрасываются кандидаты после 20-го; лимит отображения остаётся 8, исходный безопасный предел 1000. Регрессия на 22 матчах проверяет важный не-featured матч и честный счётчик. Конфликты BOARD/HANDOFF разрешены с сохранением обеих записей. Общий daily digest сохраняет прежний лимит и LIVE-приоритет.


## 2026-10-13 — Claude — Бот: новый вид «Матчи» и «LIVE»
PR: ветка `claude/bot-matches-live`
Сделано: `selectBotDayMatches` выбирает до 8 матчей по важности турнира (`featured` → не низшие лиги → `priority` → интерес), а не «LIVE первым»; `digestFixtureRows` получил опцию `liveFirst:false` и поля `country`, `lowPriority`, `goals`, `elapsed`. `botDayMatchesText` группирует матчи по турнирам («Лига · Страна»): LIVE — «🔴 63′ · A 1:0 B», предстоящие — «22:00 · A — B» (МСК), завершённые — «✓ A 2:1 B»; подзаголовок «главные 8 из N · время МСК». Кнопки в том же порядке, с минутой/временем и счётом, плюс «🔄 Обновить».
Решения: Сергей 13.10 — прежние списки «выглядят ужасно»: «Матчи» и «LIVE» показывали одинаковые 8 LIVE-матчей низших лиг, список дублировал одинаковые красные кнопки.
Осталось / внимание: ежедневная рассылка (`dailyDigestText`) не менялась и по-прежнему ставит LIVE первым и время в UTC.
## 2026-10-14 — Codex — Срочное отключение «Перелом матча»
PR: ветка `codex/match-swing-off`.
Сделано: по прямому указанию Сергея отключены посты в канал и вся задача «Перелом матча», включая личные уведомления; MATCH_SWING_ENABLED=false, CHANNEL_SWING_POST_ENABLED=false. Другие фоновые задачи не отключаются.


## 2026-10-13 — Claude — Обновление GitHub Actions (вместо Dependabot #856, #857)
PR: ветка `claude/actions-bump`
Сделано: в workflow обновлены закреплённые SHA: `actions/setup-node` 7.0.0 → 7.1.0, `actions/upload-artifact` 7.0.1 → 7.0.2, `github/codeql-action` init/analyze, `actions/download-artifact` 5 → 8.0.2 (только `backup-supabase.yml`). В `test/security-automation-config.test.js` и `test/supabase-backup-workflow.test.js` — новые SHA (из-за них падали PR Dependabot).
Решения: Сергей 13.10 — сделать одним PR, PR Dependabot убрать. После слияния Dependabot закроет #856/#857 сам; если нет — закрыть вручную.
Осталось / внимание: проверка `runtime-load` упадёт и здесь — она падает и на `main` (уже в «Идеи / найдено по пути», 12.10). После слияния стоит вручную запустить бэкап Supabase: download-artifact прыгнул на 3 мажорные версии.

## 2026-10-13 — Claude — Компактные новости в боте
PR: ветка `claude/bot-news-compact`
Сделано: `sendGeneralFootballNews` шлёт `compactNewsFeedText` — «📰 Главное в футболе», до 5 строк «N. <заголовок-ссылка> — источник» (короткие имена для ESPN, BBC, Reuters и др., иначе домен), одна кнопка «🔄 Обновить» (`news:refresh`). Избранное больше не запрашивается.
Решения: Сергей 13.10 — прежний формат «выглядит ужасно», одобрил компактный.
Осталось / внимание: `newsFeedText` (подробный формат) по-прежнему используется для новостей любимой команды; старые кнопки `news:team:<id>` в уже отправленных сообщениях продолжают работать. По ревью Codex: `nytimes.com` подписывается «The New York Times», «The Athletic» — только для ссылок `/athletic/`.

## 2026-10-13 — Claude — Порядок работы в чатах
PR: ветка `claude/claude-md-session-rules`
Сделано: в CLAUDE.md добавлен раздел «Порядок работы в каждом чате»: одна задача — новый чат, без подписки на события PR и ожидания Codex, прод-настройки только после «да», в конце задачи — подсказка следующего шага, идеи по запросу.
Решения: Сергей 13.10 — лимит расходуется слишком быстро, правила должны действовать в каждом новом чате автоматически. Также настроены задачи по расписанию: еженедельные идеи (пн ~10:00 МСК) и разовая проверка ревью Codex по #877.
Осталось / внимание: AGENTS.md не менялся — правила только для Claude.

## 2026-10-13 — Claude — Канал: публикация включена
PR: [#876](https://github.com/TRAP44/football-analytics-cloudflare/pull/876), ветка `claude/channel-posts-on`
Сделано: в `wrangler.jsonc` `CHANNEL_DAILY_POST_ENABLED` и `CHANNEL_SWING_POST_ENABLED` → `true` (фоновый запуск на GitHub Actions читает их из `wrangler.jsonc`). Тесты, закреплявшие `false`, обновлены; в коде по умолчанию по-прежнему `false`.
Решения: Сергей 13.10 — «да» на оба поста, после фильтра турниров (#871).
Осталось / внимание: первый «Матчи дня» — в ближайшее окно 11:00 МСК; «Перелом матча» — по ходу матчей главных турниров. Бот должен быть администратором `@MatchRadarFootball` с правом публикации, иначе в `ops_events` будет ошибка публикации. Выключить — вернуть `false`.

## 2026-10-13 — Claude — Бот: 6 кнопок, «Матчи»/«LIVE» с данными
PR: [#875](https://github.com/TRAP44/football-analytics-cloudflare/pull/875), ветка `claude/bot-six-buttons`
Сделано:
- Одно меню: ⚽ Матчи, 🔴 LIVE, ⭐ Мои команды, 📰 Новости, 💎 Тарифы, ⚙️ Уведомления (`footballBotMoreKeyboard` теперь возвращает то же меню). Убраны Последний разбор, Протокол AI, AI-подборка и команды /last, /track, /picks; кнопки старой клавиатуры и эти команды отвечают «Меню обновлено» с новым меню (`REMOVED_MENU_LABELS`).
- Карточка матча: убраны «Судья», «Риски матча», «Обновить AI»; старые кнопки в чатах отвечают коротким уведомлением без загрузки данных (`REMOVED_MATCH_SECTIONS`).
- «Матчи»/«LIVE» (`loadBotDayMatches`): цепочка свежий кэш → провайдер → снимок `provider-fixtures:<дата>:v1` из фонового запуска (обновляется каждые 5 минут) → устаревший кэш матчей. Раньше при истёкшем кэше (TTL 1 мин) и отказе защиты лимитов бот отвечал «не найдено», хотя шло 13 матчей. «Матчи сегодня» скрывают завершённые, если есть другие.
- «Мои команды» (`botTeamIdMatches`): при недоступном провайдере — прежний ответ из кэша.
- Проверка `telegramMiniAppE2EDrill`: в меню 6 кнопок, есть «Матчи» и «Новости». Тесты обновлены, добавлены тесты цепочки «Матчи»/«LIVE».
Решения: Сергей 13.10 — «удаляй ненужные», оставить шесть.
Осталось / внимание: функции `sendLastAiVerdict`, `sendBotAiTrackRecord`, `sendDailyPicks`, разделы referee/market остались в коде (на них опираются тесты и другие места), но из бота недоступны — можно удалить отдельной чисткой.

## 2026-10-13 — Claude — Кнопка «Разобрать матч» в карточках
PR: [#874](https://github.com/TRAP44/football-analytics-cloudflare/pull/874), ветка `claude/search-match-button`
Сделано: в `public/styles/premium-ui.css` для `.search-match-action` — ширина 100%, 14px, у предстоящих матчей фон в акценте (`--accent`, янтарный при `data-accent="system"`). Причина вида со скриншота: `.miniapp-public-shell button { font: inherit }` перебивал `font-size:11px` из `styles.css`, а футер прижимал кнопку вправо. Ревизия ассетов `6.120.0-launch113`.
Осталось / внимание: «Итоги» и «Центр матча» (идущие и завершённые) остаются нейтральными, тоже на всю ширину.

## 2026-10-13 — Claude — Бот: меньше кнопок
PR: [#873](https://github.com/TRAP44/football-analytics-cloudflare/pull/873), ветка `claude/bot-fewer-buttons`
Сделано:
- Главное меню бота — 4 кнопки, «••• Ещё» — 6 (было 6 + 8). Убраны «🔎 Найти матч», «ℹ️ Как это работает», «← Главное меню»; «🤖 AI-подборка» перенесена в «Ещё».
- «⚙️ Уведомления»: кнопки утренней подборки (`digest:on/off`, обработчики уже были) + кнопка приложения (только в личном чате).
- Обработчики старых подписей не удалялись: у пользователей со старой клавиатурой кнопки продолжают работать до следующего /start.
- Проверка `telegramMiniAppE2EDrill` теперь требует в меню «⚽ Матчи» и «••• Ещё» вместо «🔎 Найти матч»; тесты RC54/RC106/ai-instructor обновлены.
Решения: Сергей 13.10 — «уберём ненужные совсем» после того, как в «Ещё» стало 8 кнопок (в #872 добавил две и ничего не убрал).

## 2026-10-13 — Claude — Оформление бота (вариант A)
PR: [#872](https://github.com/TRAP44/football-analytics-cloudflare/pull/872), ветка `claude/bot-polish`
Сделано:
- /start: три строки вместо инструкции; убран ставочный оборот «предложит пропустить матч». Описание бота (`setMyDescription`) переписано. Справка: «fixture» и английские ссылки заменены на русские.
- «••• Ещё»: добавлены «💎 Тарифы» (`/plans`) и «⚙️ Уведомления» (`/settings`), подсказка в поле ввода. Тарифы — `src/telegram-bot-plans.js`, цены и лимиты только из конфигурации (`starsPrices`, `limits`, `passProductConfig`); 7-дневный доступ — только если продаётся (`saleReady`). Кнопки открывают Mini App на профиле: `view=profile&section=billing|notifications` (раньше `view=profile` из `/paysupport` приложение игнорировало).
- Меню «/»: start, today, live, favorites, plans, settings, help (раньше пусто — решение RC47 заменено выбором Сергея). Тесты RC47/RC51 обновлены.
- Ревизия фронтенд-ассетов `6.120.0-launch112`.
Решения: Сергей 13.10 выбрал вариант A из трёх (A — коротко, B — пошаговый первый запуск, C — всё в Mini App), аватар не менять. «ℹ️ Как это работает» оставлен в «Ещё» рядом с «Главным меню».
Осталось / внимание: команды и описание применяются при следующем /start (`configureFootballBot`).

## 2026-10-13 — Claude — Канал: фильтр главных турниров
PR: [#871](https://github.com/TRAP44/football-analytics-cloudflare/pull/871), ветка `claude/channel-league-filter`
Сделано:
- `isChannelLeague` (`src/competition-integrity-runtime.js`): турнир из справочника — по приоритету (≥ 80), вне справочника — только международные по названию (Лига чемпионов, Лига Европы, Лига конференций, ЧМ, Копа Америка), без молодёжных и женских. Используется для «Матчей дня» (`isMainFixture`) и поста «Перелом матча»; `isTopLeague` в остальном приложении не менялся.
- «Матчи дня»: подпись турнира со страной (`leagueLabel`): «Premier League, Ливан», международные — без страны. В `COUNTRY_RU` добавлены русские названия ещё ~25 стран.
- Тест `test/channel-league-filter.test.js`.
Решения: Сергей 13.10 — сначала фильтр, канал включать после.
Осталось / внимание: в «Матчах дня» неглавные матчи по-прежнему добирают пост до 5 (так задумано в #860), но теперь со страной в подписи. Включение канала — отдельным PR после «да» Сергея.

## 2026-10-13 — Claude — Фиксация результатов в фоновом запуске
PR: [#870](https://github.com/TRAP44/football-analytics-cloudflare/pull/870), ветка `claude/settle-provider-snapshot`
Сделано:
- `src/settlement-runtime.js`: перед защитой лимитов в `settleBacktestDaily` и `runSettlementFinalityVerification` вызывается `ensureProviderSnapshot` — загрузка общего снимка квоты и, если тариф не подтверждён, один запрос `/status` (не расходует дневную квоту). Ошибки глотаются, решение принимает прежняя защита.
- Зависимости `loadSharedProviderState` и `probeProviderStatus` прокинуты из `worker.js` через `operational-orchestration-runtime.js`; они необязательные — без них поведение прежнее.
- Тест `test/settlement-provider-snapshot.test.js` (падает без исправления).
Решения: проверка окончательности результатов включена в тот же PR — та же причина (пустая память о квоте в фоновом запуске), тот же вызов.
Осталось / внимание: 13.10 «Итоги дня» ушли в 10:01 МСК (3 из 3); фоновые задачи идут каждые 5 минут.

## 2026-10-13 — Claude — «Перелом матча»
PR: [#869](https://github.com/TRAP44/football-analytics-cloudflare/pull/869), ветка `claude/match-swing`
Сделано:
- `src/match-swing-job.js`: каждые 5 минут после записи точек кривой (`in_play_timeline`) берёт свежие (≤ 10 мин) точки `in-play:*` и предматчевые снимки `model_predictions`. Перелом: у фаворита до матча (отрыв ≥ 10 п. п.) оценка победы упала на ≥ 25 п. п., а соперник стал лидером оценки (≥ 45%, выше ничьей и фаворита). Рост ничьей к концу 0:0 переломом не считается. Запросов к API-Football нет.
- Лично: напоминание на матч → `match.swing` (настройка «Матчи»), любимая команда → `team.swing` («Команды»); существующая доставка smart-уведомлений (дедупликация `v1:<матч>:<тип>:swing`, один раз на матч), общий выключатель напоминаний в админке тоже их останавливает. Одно сообщение на человека и матч: с напоминанием и любимой командой — по напоминанию; кому уже ушло (или могло уйти: sending/sent/unknown) по одному поводу, по другому не отправляется (проверка по `smart_notification_deliveries`); неудачная или не начатая попытка (claimed, retry_pending, terminal_failed) не мешает отправке по актуальному поводу. Лимита матчей на запуск нет. Получатели читаются постранично (до 10 000), обрезание списка отмечается в отчёте `MATCH_SWING_RUN_DEGRADED`.
- Канал: только главные турниры (`isTopLeague`), имена без букмекерских брендов (`bettingFree`), ≤ 3 поста за день МСК — слоты `swing-slot:<дата>:1..3` в журнале идемпотентности публикаций, пост на матч — один (`channel-swing:<матч>` + `swing-done:<матч>`). Неудавшийся пост освобождает слот, неизвестный исход — нет. Выключено (`CHANNEL_SWING_POST_ENABLED=false`): вместо поста — `CHANNEL_SWING_POST_PREVIEW` в `ops_events`, одна запись на матч.
Решения (Сергей 13.10): «Канал + личные». Порог 25 п. п. и условие «соперник — лидер оценки» выбраны по данным 10–12.10: из 14 матчей с явным фаворитом без условия лидерства 7 «переломов», включая 0:0 с растущей ничьей; с условием — 6, все со счётом в пользу соперника.
Осталось / внимание: включать канал после одобрения текста Сергеем.

## 2026-10-12 — Claude — Цены ×≈2
PR: [#867](https://github.com/TRAP44/football-analytics-cloudflare/pull/867), ветка `claude/prices-x2`
Сделано: в `wrangler.jsonc` заданы `PRO_STARS_PRICE=499`, `PREMIUM_STARS_PRICE=999`, `MATCH_PASS_STARS_PRICE=75`, `DAY_PASS_STARS_PRICE=150`, `WEEKEND_PASS_STARS_PRICE=299` (раньше — значения по умолчанию в коде 199/399/39/89/149); `.env.example` обновлён. Код не менялся: цены читаются из переменных, Mini App берёт их из `/api/billing/plans`.
Решения: Сергей 12.10 — «умеренно ×≈2»; Day Pass стал ≈ трети PRO.
Ревью Codex: уже одобренный до деплоя платёж и автопродление по старой цене принимаются — `successful_payment` сверяется с текущей ценой и с ценой по умолчанию из кода (`passAcceptedStars`, `acceptedStars` в `billing-runtime.js`); в записи Pass — фактически оплаченная сумма. Pre-checkout и новые счета — только по текущей цене.
Осталось / внимание: при следующей смене цен — см. «Идеи» (список прежних цен).

## 2026-10-12 — Claude — Приглашения с наградой
PR: [#868](https://github.com/TRAP44/football-analytics-cloudflare/pull/868), ветка `claude/referral-rewards`
Сделано:
- Атрибуция приглашений уже была (`growth-referral.js`: код в ссылках «Поделиться матчем», `referred_first_open` на /start). Добавлены награды: миграция `supabase_migration_v6_29_17.sql` — таблица `referral_rewards` (RLS, только service_role) и функции `grant_referral_rewards` (атомарно: атрибуция есть, приглашающий по коду, не сам себя, пользователь новый — зарегистрирован не раньше чем за час до атрибуции, одна награда на приглашённого, у приглашающего ≤ 10 за 30 дней под advisory-lock), `reserve_referral_bonus`/`refund_referral_bonus` (по operation_id). Legacy v1-отпечаток исключает таблицу и функции.
- `src/referral-rewards-runtime.js`: начисление после успешного разбора (cached/shared/fresh, в фоне через waitUntil, один вызов базы на пользователя в изоляте), сообщение пригласившему в бота, `GET /api/referral` (ссылка `t.me/<бот>?start=ref__invite__profile__r<код>`, бонусы, приглашено за 30 дней). Лимит запросов 20/мин.
- `analysis-runtime.js`: если дневной лимит исчерпан и бонус есть (`hasReferralBonus`) — `reserveReferralBonus`; в finally: разбор выдан — `commitReferralBonus`, нет — `refundReferralBonus`. Жизненный цикл без новой схемы: резерв = `status used` + `operation_id`, commit очищает `operation_id`; незакоммиченный резерв старше 15 минут возвращается сам (`releaseStaleReservations` перед проверкой/резервом/сводкой) — бонус не теряется при потерянном ответе базы, сбое возврата или падении воркера.
- Профиль: «🎁 Пригласить друга» (`public/modules/referral-invite.js`) — Telegram share composer. Ревизия — launch111.
- SQL функций прогнан на локальном Postgres 16: новый пользователь, повтор, старый пользователь, сам себя, не приглашён, лимит 10, резерв/возврат с чужим и своим operation_id, права anon/service_role.
Решения (Сергей 12.10): награда «1 матч» сделана как +1 бонусный разбор любого матча, не Match Pass (Match Pass привязан к матчу и учитывается как покупка за звёзды); засчитывается после первого разбора друга; другу тоже +1.
Осталось / внимание: миграция v6.29.17 применена в прод 12.10 (после «да» Сергея); прод v2 `af06ba7b6d944750f312e5cbfd4b5f20`, чистая установка `0169ec29ea39da9d085040ed825057a6`. До деплоя старый воркер показывает в мониторе «schema drift» — проходит после слияния. Бонус тратится только когда дневной лимит исчерпан; Pass/подписка не затрагиваются.
## 2026-10-12 — Claude — Карточка «AI угадал»
PR: [#866](https://github.com/TRAP44/football-analytics-cloudflare/pull/866), ветка `claude/ai-guessed-card`
Сделано:
- `/api/match-pick`: в проверенном итоге (`result`, только при confirmed/adjudicated) — счёт `actual_home/away_goals`, вероятность выбранного AI исхода из того же предматчевого снимка (`aiProbability`, только если сумма 98–102), названия команд и турнира из `model_predictions`.
- `public/modules/ai-guessed-card.js`: модель карточки (кто угадал → «Вы и AI угадали» / «AI угадал» / «Вы обыграли AI»; никто — карточки нет), рисование в canvas 1080×1080 (тёмная база, янтарь `#fbbf24`), шаринг: `navigator.share({files})`, если поддерживается, иначе окно с картинкой и подсказкой «нажмите и удерживайте». Кнопка «📸 Карточка …» — в карточке «Обыграй AI» после итога. Ревизия — launch110.
Решения: картинка рисуется на устройстве — без новых серверных зависимостей; на карточке только проверенные числа, подпись «аналитика, а не гарантия результата».
Осталось / внимание: в Telegram на iOS системное «Поделиться» с файлом может быть недоступно — тогда окно с картинкой.

## 2026-10-12 — Claude — Ежедневный пост в канал «Матчи дня»
PR: [#860](https://github.com/TRAP44/football-analytics-cloudflare/pull/860), ветка `claude/channel-daily-post`
Сделано:
- `src/channel-daily-post-job.js`: в окне 11:00–11:14 МСК (08:00–08:14 UTC) берёт сегодняшние предстоящие (≥ 30 минут до начала) матчи с валидным предматчевым снимком (`model_predictions`), сначала главные (`isTopLeague`), до пяти, по времени начала. Текст: «⚽ Матчи дня по версии модели MatchRadar — 12 октября», для каждого — время МСК, команды, турнир, «Команда 48% · Ничья 27% · Команда 25%», в конце — «Оценки модели до матча… Это аналитика, а не рекомендация.» Кнопка — ссылка в Mini App на первый матч (`fixtureTelegramDeepLink`, `campaign=daily_post`).
- Публикация — существующий `publishChannelMessage` (отдельный бот-публикатор, журнал идемпотентности) с ключом `channel-daily:<дата>`: дважды за день не опубликует.
- Выключено по умолчанию (`CHANNEL_DAILY_POST_ENABLED=false` в `wrangler.jsonc`): пока выключено, раз в сутки в `ops_events` пишется `CHANNEL_DAILY_POST_PREVIEW` с текстом поста — частями до 480 символов (`meta.part`/`meta.parts`, журнал режет сообщения до 500), полный текст ещё и в кеше `channel-daily-preview:<дата>:v1`. У каждой части свой `transitionKey` (`channel-daily-preview:<дата>:<версия текста>:<часть>/<всего>`, версия — 12 hex SHA-256 текста, она же в `meta.version`): повтор того же текста не создаёт дублей, изменившийся текст пишется полным новым набором. Метка «предпросмотр за день записан» — заявка `telegram:channel-publish:v1:daily-preview:<дата>` в общем журнале идемпотентности; ставится только после сохранения всех частей, иначе следующий запуск в окне дописывает недостающие. В пост попадают только матчи текущего дня по Москве.
Осталось / внимание:
- Сергей: посмотреть предпросмотр (Claude пришлёт текст) и решить, включать ли — тогда `CHANNEL_DAILY_POST_ENABLED` → `"true"` отдельным PR. Нужен `TELEGRAM_PUBLISHER_BOT_TOKEN` (в Cloudflare и в окружении `background-jobs` GitHub), бот-публикатор — администратор канала.
## 2026-10-12 — Claude — «Обыграй AI»
PR: [#864](https://github.com/TRAP44/football-analytics-cloudflare/pull/864), ветка `claude/beat-the-ai`
Сделано:
- Миграция `supabase_migration_v6_29_16.sql`: таблица `match_picks` (telegram_id, fixture_id, pick home/draw/away, kickoff_at; PK пользователь+матч), RLS, доступ только service_role (select/insert/update). `backend_schema_fingerprint()` (v1) исключает таблицу — legacy-отпечатки не меняются.
- `src/match-picks-runtime.js`: `GET/POST /api/match-pick` — прогноз только в матчах с предматчевым снимком модели и только до `model_predictions.kickoff_at`, менять можно до начала; `GET /api/picks-leaderboard` — 30 дней, топ-10, «вы против AI на тех же матчах», ожидающие итога. Очки считаются из `model_predictions` (`status = settled` и `settlement_verification_state` = confirmed/adjudicated, `actual_outcome`), AI = `predicted_outcome`; до проверки финальности — «итог проверяется». Таблица читает все прогнозы окна страницами по 1000 (до 20 000, иначе честная пометка). В таблице — только `first_name` (без @username, фамилии, ссылок). Лимиты: запись 20/мин, таблица 20/мин.
- UI: `public/modules/beat-ai.js` (ленивый): карточка «🎯 Обыграй AI» во вкладке ✦ AI Штаба матча (кнопки хозяева / ничья / гости, выбор AI показывается после своего, итог +1/0), таблица в Профиле. Ревизия — launch109.
Решения (Сергей 12.10): Штаб матча + Профиль; 1 очко за исход; только имя из Telegram.
Осталось / внимание: миграция применена в прод 12.10 (Claude, Supabase MCP, `supabase_migration_v6_29_16`): v2 `449654e6…` (после доп. гранта delete для service_role — `match_picks_service_role_delete_v6_29_16`, как у всех таблиц, иначе падает проверка восстановления), legacy `2557…` без изменений, RLS включён, anon/authenticated без доступа. Чистая установка — v2 `d87de7ad…` (аннотация CI).

## 2026-10-12 — Claude — Переключатель AI в админке
PR: [#863](https://github.com/TRAP44/football-analytics-cloudflare/pull/863), ветка `claude/admin-ai-switch`
Сделано:
- Миграция `supabase_migration_v6_29_15.sql`: `runtime_controls.ai_enabled boolean not null default true`; правило журнала `runtime_controls_atomic_history` пересоздано с `aiEnabled` в снимке (откат восстанавливает переключатель); `backend_schema_fingerprint()` (v1) исключает новую колонку — legacy-отпечатки не меняются. Определение Security Lockdown в журнале прежнее.
- `src/runtime-controls.js`: `aiEnabled` — необязательное поле (до миграции и в старых точках журнала = включён; неверный тип — fail-closed). Запись `ai_enabled` — только если колонка есть; выключить AI до миграции нельзя (`RUNTIME_CONTROLS_AI_SCHEMA`). Старая панель без `aiEnabled` не меняет значение. Lockdown выключает AI, снятие — включает.
- Объяснение матча при выключенном AI строится по порядку фактов без Workers AI; в вопросах работают готовые подсказки, свой вопрос — «Свои вопросы к AI временно выключены». Админка: переключатель «AI (Workers AI)». Ревизия — launch108.
- Контракт: v2-отпечаток прода после миграции `c7164151…` (посчитан на проде тем же запросом с добавленной колонкой), чистой установки — `13c5b940…` (из аннотации CI); прежние `f3d899…`/`d0ec…` остаются совместимыми. CI чистой установки теперь пишет фактические отпечатки в аннотацию проверки.
Решения: порядок выката — миграция с именем `supabase_migration_v6_29_15` применяется до деплоя (шлюз миграций в deploy-production); до деплоя старый Worker видит новый отпечаток как дрейф — окно короткое, функции не выключаются.
Осталось / внимание: миграция применена в прод 12.10 (Claude, Supabase MCP, имя `supabase_migration_v6_29_15`); после неё в проде v2 `c7164151…`, legacy `2557…` — как в контракте. До деплоя этого PR старый Worker видит новый v2-отпечаток как дрейф.
## 2026-10-12 — Claude — Оценка по ходу матча в уведомлениях о голе
PR: [#859](https://github.com/TRAP44/football-analytics-cloudflare/pull/859), ветка `claude/goal-alert-live-estimate`
Сделано:
- `src/scheduled-jobs.js`: `in_play_timeline` запускается раньше `smart_notifications` (`Promise.all([importantChangeTask, inPlayTimelineTask])`) — к моменту уведомления точка уже со свежим счётом.
- `src/smart-notification-service.js`: `inPlayEstimateLine` — строка «📊 Оценка модели сейчас (1:0, 61′): Спартак 77% · Ничья 17% · Зенит 6%» в уведомлении о голе / красной карточке. Только если точка не старше 10 минут, сумма 98–102 и сумма голов в точке равна числу голов в событиях уведомления (иначе строки нет — не показываем оценку со старым счётом). Точку грузит `getLatestInPlayEstimate` (worker) один раз на матч и только если в событиях есть гол или удаление.
Решения:
- Уведомление не задерживается и не отменяется, если оценки нет — просто без строки.
Осталось / внимание:
- Точка есть только у матчей с предматчевым прогнозом.
## 2026-10-12 — Claude — Фоновые задания сами узнают тариф API-Football
PR: [#862](https://github.com/TRAP44/football-analytics-cloudflare/pull/862), ветка `claude/provider-status-probe`
Сделано:
- Причина «0 предматчевых прогнозов»: в процессе cron-runner нет своей памяти о квоте, а общий снимок `provider-state:api-football:quota:v1` живёт 30 минут после последнего запроса к провайдеру. Без трафика пользователей снимок истекал, тариф становился UNKNOWN, и `providerBudgetDecision` всегда отвечал `provider_daily_reserve`; кривая по ходу матча тоже не могла запросить ленту.
- Новый `src/provider-status-probe.js`: `ensureProviderSnapshot` — загрузить общий снимок, и если тариф не подтверждён (UNKNOWN или устаревший FREE), один раз спросить `/status`. Подключён в `prematch-prediction-job.js` и `in-play-timeline-job.js` вместо прямого `loadSharedProviderState`.
- `createProviderStatusProbe` (там же, подключён в `src/worker.js`): `apiFootball('/status')` (без повторов, 5 с), не чаще раза в минуту на процесс; задание, пришедшее во время запроса, ждёт тот же запрос. Снимок обновляется по заголовкам через общий шлюз, а если заголовков нет — по телу ответа (`requests.limit_day` / `requests.current`).
Решения: `/status` по документации API-Football не расходует дневную квоту; во время cooldown запрос не делается.
Осталось / внимание: после слияния проверить в `ops_events` событие задания предматчевых прогнозов с `computed > 0`.

## 2026-10-12 — Claude — Оценка по ходу матча на карточках главной
PR: [#858](https://github.com/TRAP44/football-analytics-cloudflare/pull/858), ветка `claude/live-cards-in-play`
Сделано:
- Раньше у идущих матчей полоски вероятностей на карточках не было совсем (`!m.live && !m.finished`). Теперь `/api/matches` для `live` матчей добавляет `aiLiveProbabilities` — последнюю точку кривой `in_play_model` за 30 минут (`getLatestInPlayProbabilities` в `src/worker.js`, сумма 98–102, минута из точки); поиск — с тем же сроком 1.5 с и кешем 60 с, что и предматчевые вероятности, сбой не ломает ленту. Из закешированной ленты поле никогда не проходит насквозь.
- `aiConfidenceMeterHtml`: у идущего матча — только эта оценка с подписью «✦ Сейчас по ходу матча · 61′»; нет оценки — ничего (предматчевые цифры и цифры разбора во время игры не показываются). Карточки в `app.js` и `home-signal.js` вызывают его для всех незавершённых матчей. Ревизия — launch107.
Осталось / внимание:
- Точки пишутся только у матчей с предматчевым прогнозом и при работающих фоновых задачах — у остальных идущих матчей полоски нет, как и раньше.

## 2026-10-12 — Claude — Чистка стилей после «только янтарь»
PR: [#855](https://github.com/TRAP44/football-analytics-cloudflare/pull/855), ветка `claude/css-cleanup-ocean-accents`
Сделано:
- `public/styles.css`, `public/styles/premium-ui.css`, `public/styles/public-shell.css`: удалены `:root[data-theme="ocean"]`, `html[data-theme="ocean"] .miniapp-public-shell`, `.theme-preview.ocean`, все `.accent-option(s)` / `.accent-swatch` и неиспользуемый `.appearance-help`. Разметки и JS эти стили после #845 не касались.
- Тесты, которые проверяли наличие этих стилей, переписаны на их отсутствие. Ревизия — launch106.
Осталось / внимание:
- `ACCENT_PALETTES` (пустой) и ветка `applyAccentPreference` в JS оставлены — на них опираются тесты модуля настроек; поведение не меняют.
## 2026-10-12 — Claude — Красные карточки в модели по ходу матча
PR: [#854](https://github.com/TRAP44/football-analytics-cloudflare/pull/854), ветка `claude/in-play-red-cards`
Сделано:
- `src/in-play-model.js` (v2): после удаления ожидаемые голы удалённой команды до конца матча ×0.75, соперника ×1.9 (до трёх удалений на команду, множители перемножаются). Значения — середина диапазона исследований: Ridder, Cramer, Hopstaken 1994 (соперник +88%, удалённая без изменений) и Červený, van Ours, van Tuijl 2016 (соперник ≈ +120%, удалённая ≈ −47%). Это допущение — оно написано под графиком.
- `src/in-play-timeline-job.js`: события идущих матчей с предматчевой оценкой — один запрос `/fixtures?ids=…` на 20 матчей (до трёх за запуск), только при доступном бюджете; удаление (в т.ч. вторая жёлтая) — по `team.id`. Не удалось получить — последние известные удаления из прошлой точки (их не становится меньше), иначе ноль. Удаление — новая точка (`event`/`confirmed`), в `provenance.reds` — счёт удалений и источник.
- Подпись кривой: «…по счёту, оставшемуся времени и удалениям (после красной карточки ожидаемые голы команды ×0.75, соперника ×1.9 — по средним оценкам исследований); ход игры она не учитывает.» Ревизия — launch105 (launch104 у #853).
Осталось / внимание:
- Параметр `ids` у `/fixtures` через ретранслятор Supabase в проде ещё не вызывался; при ошибке модель просто работает без новых удалений (последние известные сохраняются). Проверить вечером `provenance.reds.source = events` у точек.
## 2026-10-12 — Claude — Оценка по ходу матча в Штабе матча
PR: [#853](https://github.com/TRAP44/football-analytics-cloudflare/pull/853), ветка `claude/live-estimate-match-center`
Сделано:
- `public/modules/match-center-view.js`: `latestInPlayEstimate(timeline)` берёт самую новую точку кривой с `provenance.source = in_play_model` (сумма 100 ± 1.2), `inPlayEstimateHtml` — карточка «Сейчас по ходу матча» (минута, счёт, 1/X/2, полоска в цветах кривой, подпись о том, что учитывается). Только для LIVE, во вкладке AI над «Честностью модели». Новых цифр не считает — только показывает сохранённую сервером точку.
- `public/app.js`: в полном разборе во время матча под «Наиболее вероятный исход» — «Оценка по данным до матча — счёт её не меняет. Оценка по ходу матча — в Штабе матча.»
- Ревизия — launch104.
Решения:
- Вероятности в самом разборе не подменял: это сохранённый разбор пользователя, его цифры остаются как были, но честно подписаны.
Осталось / внимание:
- Карточки на главной во время матча по-прежнему показывают предматчевые вероятности (`aiProbabilities` из `model_predictions`) — можно так же подписать или заменить последней точкой, если Сергей захочет.
## 2026-10-12 — Claude — Больше предматчевых прогнозов
PR: [#852](https://github.com/TRAP44/football-analytics-cloudflare/pull/852), ветка `claude/prematch-limit-60`
Сделано:
- `wrangler.jsonc` (их же читает запуск фоновых задач в GitHub) и `.env.example`: `PREMATCH_PREDICTIONS_DAILY_LIMIT` 20 → 60, `PREMATCH_PREDICTIONS_PER_RUN` 2 → 3 (интервал прежний — 30 минут). Значения по умолчанию в коде не менял.
Решения:
- На 12.10 в `model_predictions` всего 5 строк: фоновые задачи почти не работали с 9.10, а потолок 20 в сутки мал для ленты. Тариф Pro — 7500 запросов в сутки; системный разбор матча тратит порядка десятка запросов (часть данных из кеша), то есть до ~600–900 в сутки на прогнозы — в пределах. Бюджет по-прежнему стерегут `providerBudgetDecision` и суточный потолок (`claimDailyBudget`).
Осталось / внимание:
- Через сутки посмотреть `ops_events` `PREMATCH_PREDICTIONS_RUN`: сколько посчитано и не упираемся ли в лимит источника.
## 2026-10-12 — Claude — Монитор прода: ложная тревога о схеме
PR: [#851](https://github.com/TRAP44/football-analytics-cloudflare/pull/851), ветка `claude/monitor-schema-fingerprint`
Сделано:
- Как только фоновые задачи снова пошли (GitHub, 12.10), монитор каждые 15 минут поднимал `PRODUCTION_MONITOR_INCIDENT` (critical): `schemaMissing: ["schema_fingerprint"]`, при `releaseScore: 100`.
- Причина: `readSupabaseSchemaFingerprint` вызывал `backend_schema_fingerprint()` — замороженную функцию совместимости v1 (в проде 2557…, это `legacyFingerprint` из `release-contract.json`), а сравнивал с `EXPECTED_SCHEMA_FINGERPRINT` — отпечатком контракта v2 (f3d899…). Схема в порядке: `backend_schema_contract_v2()` в проде = f3d899…, миграции — до v6_29_14. До 9.10 тревоги не было видно, потому что cron не доходил до монитора.
- Теперь монитор вызывает `backend_schema_contract_v2()` и принимает отпечатки из `COMPATIBLE_SCHEMA_FINGERPRINTS` (как готовность `/health`). Тест `test/monitor-schema-fingerprint-v2.test.js`.
Осталось / внимание:
- `DAILY_DIGEST_SLO_MISSING_RUN` 12.10 — следствие простоя фоновых задач; проверить вечером, что итоги дня пошли.

## 2026-10-12 — Claude — Исправления по повторному ревью Codex #836 и #839
PR: [#848](https://github.com/TRAP44/football-analytics-cloudflare/pull/848), ветка `claude/codex-fixes-836-839`
Сделано:
- #836, P2 «fallback только для 1H»: `src/ai-timeline.js` — минута по часам только у снимков со статусом `1H`; снимок `NS`, сохранённый после назначенного времени (задержка старта), остаётся точкой «до матча».
- #839, P2 «неподтверждённый состав»: `public/modules/lineup-pitch.js` — у каждой команды метка «состав подтверждён / неполный состав / состав не подтверждён» (как в прежнем списке), для неподтверждённого — нейтральное предупреждение под полем (причину понижения не угадываем — ревью Codex #848).
- #839, P2 «запасные без стартовых»: если стартовых нет, но есть запасные — пустое состояние и списки запасных.
Решения:
- #836, P2 «старые минуты второго тайма»: не исправлял — в `analysis_timeline_snapshots` 3 строки, все `NS` без минуты (проверено 12.10), строк второго тайма с минутой по часам нет; новые снимки берут минуту источника. Ответ — в треде.
Осталось / внимание:
- Ревизия — launch103.
## 2026-10-12 — Claude — Задача 3 (часть 2): кривая по ходу матча
PR: [#847](https://github.com/TRAP44/football-analytics-cloudflare/pull/847), ветка `claude/in-play-curve`
Проверено, чего не хватало: модель разбора считает вероятности только по предматчевым данным (рынок — предматчевые `/odds`), счёт и минуту не учитывает — точки во время матча почти не двигались даже после гола. Решение Сергея 12.10: делать оценку по ходу матча.
Сделано:
- `src/in-play-model.js`: из первого предматчевого снимка (`model_predictions`) подбираются ожидаемые голы хозяев и гостей (две пуассоновские величины, P(победа хозяев) и P(победа гостей) совпадают с прогнозом), дальше — исходы при текущем счёте и оставшемся времени. Поправочные множители дают на 0′ при 0:0 ровно предматчевую оценку. Только `1H`/`HT`/`2H`; овертайм и пенальти — без оценки. Красные карточки, добавленное время и ход игры не учитываются — это написано под графиком.
- `src/in-play-timeline-job.js`: задача `in_play_timeline` в каждом запуске фоновых задач. Идущие матчи — из пакета матчей дня (кеш `provider-fixtures:<дата>:v1`; если устарел и бюджет источника позволяет — один запрос `/fixtures?date`, он же обновит кеш приложению), только с предматчевым снимком. Точка пишется в `analysis_timeline_snapshots` (`in-play:<матч>:<время>`, `provenance.source = in_play_model`, счёт в `provenance.score`) при смене счёта (`event`/`confirmed`) или сдвиге ≥ 1 п. п. (`model_update`); не больше 60 точек на матч. Без миграций: значения укладываются в ограничения таблицы.
- Кривая (`public/modules/ai-timeline.js`): если есть точки по ходу матча, во время матча показываются только они (разбор, открытый в эфире, счёт не учитывает); подпись объясняет, что учитывает оценка. Ревизия — launch102.
Решения:
- В TASKS было «без прогнозов на будущее и экстраполяции» — решение Сергея 12.10 это снимает для кривой по ходу матча.
Осталось / внимание:
- Работает, только когда фоновые задачи идут каждые 5 минут (#846 + токен). Точки появятся только у матчей с предматчевым снимком (задача 2 и разборы пользователей).
- Ревью Codex (2 × P2) исправлено: добавленное время 1-го тайма не уменьшает 2-й тайм; матчи, начавшиеся до полуночи UTC, берутся из вчерашнего пакета (в 00–04 UTC он обновляется одним запросом, если там есть недоигранный матч).
## 2026-10-12 — Claude — Задача 0: срочное исправление гейта деплоя
PR: [#849](https://github.com/TRAP44/football-analytics-cloudflare/pull/849), ветка `claude/deploy-gate-hotfix`
Сделано:
- Живая проверка 12.10: Сергей добавил `GITHUB_DISPATCH_TOKEN` в панели Cloudflare, деплой #845 (run 2518) остановился: «Active production version fcfe1aac-… has no CI release stamp and was not created by a secret change» — версия из панели помечена не `workers/triggered_by: secret`.
- `scripts/cloudflare-settings-version.js`: версия «после правки настроек» — любая версия без действительной отметки CI (сообщение `release=… sha=…` и тег, равный SHA). Пометка триггера больше не решает; решает доказательство: история деплоев ведёт к версии CI, и хеш кода (`resources.script.etag`) совпадает. Чужой код (загрузка в панели, ручной `wrangler deploy`) по-прежнему отклоняется — хеш другой.
- Если деплой всё же блокируется, в Summary пишутся пометки активной версии и основы (`--describe-version`: trigger, source, есть ли сообщение/тег/хеш) — без значений.
Осталось / внимание:
- После слияния деплой пойдёт по этому пути впервые — проверить Summary (#845 выкатится вместе с ним). Если там `etag=none`, хеш кода в API для такой версии не отдаётся — тогда нужен другой способ доказательства.

## 2026-10-12 — Claude — Оформление: один янтарный акцент, тёмная/светлая тема
PR: [#845](https://github.com/TRAP44/football-analytics-cloudflare/pull/845), ветка `claude/amber-only-appearance`
Сделано:
- Решение Сергея 12.10 («оставь янтарный только и выбор тёмный или светлый»): в профиле (и в `admin.html`) убраны «Акцентный цвет» (зелёный/синий/фиолетовый/янтарный/как в теме) и тема «Океан». Остались «Telegram» (авто тёмная/светлая), «Тёмная», «Светлая» и форма кнопок.
- `public/modules/app-runtime.js`: допустимые темы — `system`/`dark`/`light`, акцент — только `system` (янтарь из CSS). Сохранённые раньше `ocean`, `green`, `blue`, `violet`, `amber` при чтении сбрасываются — у кого был сохранён другой цвет (у Сергея на телефоне был зелёный), увидят янтарь.
- `ui-preferences.js`: подпись «Дополнительное оформление» — только «Строгие кнопки» / «По умолчанию». Рендер-смоук гоняет темы `dark`/`light`. Ревизия ассетов — launch101.
Решения:
- Кнопку «Telegram» оставил: она тоже даёт только тёмную или светлую тему (по настройке Telegram) и стоит по умолчанию.
- Ревью Codex (P2): `admin.html` не грузит `premium-ui.css`, где были янтарные правила, — правила `html[data-accent="system"]` добавлены и в `public-shell.css` (его грузят обе страницы).
- CSS темы «Океан» и палитр акцентов не удалял — стал мёртвым, но безвредным; можно убрать отдельным мелким PR.
Осталось / внимание:
- Если #844 (задача 0) сольётся раньше — в доске/журнале при слиянии оставить обе записи.
## 2026-10-12 — Claude — Фоновые задачи: cron Cloudflare запускает GitHub Actions
PR: [#846](https://github.com/TRAP44/football-analytics-cloudflare/pull/846), ветка `claude/cron-dispatch`
Сделано:
- Расписание GitHub (`schedule`) в этом репозитории срабатывает раз в 4–7 часов (почасовой «External Production Monitor» — 4–5 раз в сутки), поэтому `*/5` из #838 фактически не работает: после ручного запуска 11.10 20:29 UTC задач не было.
- Cron Cloudflare снова включён (`*/5 * * * *`), но задач не выполняет: при `BACKGROUND_JOBS_EXECUTOR=github` воркер делает один запрос `workflow_dispatch` к `cron-runner.yml` на `main` (`src/github-dispatch-runtime.js`) — укладывается в 10 мс CPU Workers Free. Сам запуск из GitHub (`CRON_RUNNER=github-actions`) никого не вызывает.
- Нет токена — ничего не делает (как сейчас). Ошибка запроса — `ops_events` `BACKGROUND_JOBS_DISPATCH_FAILED` не чаще раза в час на изолят, без токена в тексте.
Решения:
- Токен — fine-grained, только этот репозиторий, «Actions: Read and write» (запуск workflow, код не меняет), только секрет Cloudflare `GITHUB_DISPATCH_TOKEN`. Альтернативы (cron-job.org, pg_cron) требуют токен в ещё одном сервисе.
- Расписание GitHub оставлено запасным. Лишние запуски безопасны: блокировка `cron-global` и `concurrency: background-jobs`.
Осталось / внимание:
- Сергей: создать токен и добавить секрет в Cloudflare (шаги — в PR). Правка секрета создаёт версию без отметки CI — следующий деплой пропустит только #844, поэтому #844 сливать раньше.
- Проверка после включения: `scheduled_job_leases` — `cron:<время>` со статусом `done` каждые 5 минут.
## 2026-10-12 — Claude — Задача 0: деплой после правки секрета в панели Cloudflare
PR: [#844](https://github.com/TRAP44/football-analytics-cloudflare/pull/844), ветка `claude/deploy-gate-dashboard-versions`
Сделано:
- Правка секрета в панели (или `wrangler secret put`) создаёт версию без отметки CI (`workers/triggered_by: secret`) — раньше «Deploy Production» на ней останавливался («release identity mismatch»). Теперь, если отметки нет, шаг «Detect pending production artifact changes» идёт по `wrangler deployments list` назад через версии «после правки секрета» до версии с отметкой CI (`scripts/verify-production-release-postcondition.js`, `--print-settings-base-version-id` / `--print-settings-rollback-target`).
- Доказательство «код тот же» — `resources.script.etag` (хеш кода) активной версии равен хешу версии CI. Нет хеша, другой хеш, смешанный трафик, загрузка без отметки, дыра в истории — деплой по-прежнему блокируется.
- Цель отката — сама активная версия «после правки секрета», а не версия CI: откат не откатит секреты. `scripts/verify-rollback-target.js` принимает её только с JSON версии-основы (7-й аргумент); preflight и автоматический откат передают основу. Деплой в этом случае обязателен (`changed=true`) — новая версия снова с отметкой CI.
Решения:
- Ревью Codex (P2): `wrangler versions list` хранит только 10 последних версий — загрузки без деплоя могли вытеснить основу. Теперь каждая версия из истории деплоев загружается по ID (`--print-history-version-ids` → `wrangler versions view`), список собирается `jq -s`.
- Принимаем только триггер `secret` (в wrangler: «Secret Change»). Правка переменных в панели, если Cloudflare помечает её иначе, останется заблокированной — тогда расширим список по факту.
- В TASKS было «откат на последнюю версию с отметкой CI»; выбрана активная версия, доказанно с тем же кодом — так откат не теряет секреты.
Осталось / внимание:
- Проверено локально на поддельных JSON Cloudflare; на живой правке секрета ещё не проверялось. `npm ci` локально недоступен (нет доступа к registry), `verify:worker` и `npm audit` проверит CI.

## 2026-10-12 — Claude — Доска: итог 11.10
PR: [#843](https://github.com/TRAP44/football-analytics-cloudflare/pull/843), ветка `claude/board-cleanup`
Сделано: задача 4 (#839) — в «Готово»; раздел «Ждут ревью Codex» убран — вся очередь проверена (#815 → #817, #825/#806 → #837).
Осталось / внимание:
- Строка задачи 1 (#805) — Codex: PR слит 10.10, строку перенесёт автор.
- Фоновые задачи идут из GitHub Actions (`background-jobs`); первый полный запуск — 11.10 23:29. Cloudflare продолжает вызывать удалённый cron — воркер выходит сразу (`BACKGROUND_JOBS_EXECUTOR=github`).
- Старые открытые PR от 07.10: #633 и #639 (контрольные PR под старый красный Quality — main давно зелёный), #616 (download-artifact v8 в бэкапе — CI красный), #615 (wrangler 4.147 только в `package.json`, а деплой закреплён на 4.141.0 в `deploy-production.yml`). Рекомендация Claude — закрыть; обновление wrangler при необходимости сделать отдельным PR сразу в обоих местах.
- Ждут решения Сергея: задача 0 (гейт деплоя после правки секретов в панели), бренд-SVG в янтарь, отдельный выключатель AI в runtime controls.

## 2026-10-11 — Claude — Задача 4: экран составов (2.5D поле)
PR: [#839](https://github.com/TRAP44/football-analytics-cloudflare/pull/839), ветка `claude/lineup-pitch`
Сделано:
- `public/modules/lineup-pitch.js`: обе команды на одном поле — хозяева снизу (янтарь), гости сверху (синий, зеркально). Расстановка только по `grid` источника (`ряд:позиция`, ≥8 игроков с сеткой), иначе — прежний список (`lineupLiveHtml`). Перспектива — расчётом координат (дальняя половина уже, фишки меньше) + SVG-разметка поля; без WebGL/canvas/3D-трансформаций текста.
- Фишка: номер + фамилия; полное имя и роль (вратарь/защитник/…) — в `aria-label`. Схема и тренер у каждой команды, запасные — раскрывающимися списками.
- Состояния: «Составы пока не объявлены — обычно за час до начала», «Источник не передал составы» (LIVE/завершён), только одна команда (вторая половина с пометкой), неполный состав — предупреждение. «Вероятных» составов нет.
- Вкладка «Составы» в Штабе матча; модуль подгружается вместе с ленивым `match-center-view.js` (стартовый JS не растёт).
Решения: макета «E-lineup» у Сергея нет — дизайн сделан в фирменном стиле (тёмный «стадион», янтарь).
Осталось / внимание:
- Ревизия ассетов — launch97 (совпадает с #834–#836; кто сольётся позже — поднимет номер).
## 2026-10-11 — Claude — Задача 3 (часть 1): кривая вероятностей в Штабе матча
PR: [#836](https://github.com/TRAP44/football-analytics-cloudflare/pull/836), ветка `claude/live-probability-curve`
Проверено, что уже было: снимки `analysis_timeline_snapshots` пишутся только при разборе матча пользователем; `renderAiProbabilityChart` существовал, но **нигде не показывался**; ось — время сохранения, без событий матча.
Сделано:
- `renderAiProbabilityChart(timeline, match, events)` — кривая по минутам матча: последний снимок до старта как точка «до», дальше реальные снимки с минутой; отметки ⚽ (без незабитых пенальти) и 🟥 (в т.ч. вторая жёлтая) из событий; подписи для скринридера со всеми точками и событиями; меньше двух точек — «Кривая появится по ходу матча» / «сохранено меньше двух оценок».
- Штаб матча (вкладка AI) показывает кривую для LIVE и завершённых матчей. Цвета: хозяева — янтарь, ничья — серый, гости — синий.
- Прежний график по времени сохранения остался для компактной истории (`renderAiProbabilityHistoryChart`).
Осталось / внимание:
- Периодические LIVE-снимки (по событиям и раз в несколько минут) не сделаны: нужна фоновая задача с пересчётом и бюджет API-Football; cron на Workers Free не доходит до конца (см. «Идеи»). Сейчас точки появляются, когда пользователи открывают разбор во время матча.
- Ревизия ассетов — launch97 (совпадает с #834/#835 — кто сольётся позже, поднимет номер).
## 2026-10-11 — Claude — Фоновые задачи: проверка ключа как у воркера
PR: [#842](https://github.com/TRAP44/football-analytics-cloudflare/pull/842), ветка `claude/cron-runner-apikey`
Причина (запуск №4): воркер шлёт ключ Supabase только в `apikey` (`src/supabase-client.js`, так нужно для `sb_secret_…`), а в GitHub лежал старый JWT `service_role` → 401 на все запросы; пробный запрос из #840 слал ещё и `Authorization: Bearer` и потому проходил.
Сделано: пробный запрос отправляет ключ так же, как воркер; при 401/403 с не-`sb_secret_` ключом — подсказка завести секретный ключ в `SUPABASE_SECRET_KEY`. Журнал запросов показывает адрес и для `URL`-объектов (раньше «?»).
Решение Сергея: для GitHub отдельный секретный ключ Supabase (`github_background_jobs`), отзывается независимо от Cloudflare.
- «Призрачный» cron Cloudflare: расписание удалено и в `wrangler.jsonc`, и в панели, но запуски с `:46` продолжаются и занимают блокировку `cron-global`. Добавлено `BACKGROUND_JOBS_EXECUTOR=github` (wrangler vars): `scheduled()` воркера сразу выходит, если вызов не от `cron-runner` (тот ставит `CRON_RUNNER=github-actions`).

## 2026-10-11 — Claude — Фоновые задачи: журнал запросов при сбое
PR: [#841](https://github.com/TRAP44/football-analytics-cloudflare/pull/841), ветка `claude/cron-runner-trace`
Причина: запуск №3 прошёл проверку ключей (#840), но задачи снова не запустились, а в `ops_events` нет записей — нужна видимость, что именно ответил Supabase.
Сделано: при сбое `cron-runner` печатает последние 40 запросов воркера — метод, сервис, путь без query и HTTP-статус; токен бота в пути Telegram заменяется на `***`, значения ключей не выводятся.

## 2026-10-11 — Claude — Фоновые задачи: диагностика ключей Supabase
PR: [#840](https://github.com/TRAP44/football-analytics-cloudflare/pull/840), ветка `claude/cron-runner-diagnostics`
Причина: первый ручной запуск Background Jobs завершился «задачи не запускались» без единой записи в `ops_events` — воркер ушёл в защитный режим, потому что Supabase не принял адрес/ключ, и записать причину в базу тоже не смог.
Сделано: `scripts/cron-runner.js` до запуска задач проверяет формат `SUPABASE_URL` (https://<проект>.supabase.co) и ключа (anon/publishable/обрывок → понятный текст), затем делает пробный запрос к `runtime_controls` и сообщает 401/403/404/сеть. Значения ключей в выводе не появляются.

## 2026-10-11 — Claude — Задача 6: «Спросить про матч»
PR: [#835](https://github.com/TRAP44/football-analytics-cloudflare/pull/835), ветка `claude/match-questions`
Сделано:
- `POST /api/match-question` (`src/match-question-runtime.js`): только для матчей из истории пользователя, по сохранённому анализу. Готовые подсказки («Почему такой прогноз?», «Что может изменить исход?», «Кто в форме?», «Что с составами и потерями?») — детерминированный выбор фактов по ролям/типам, без LLM и без лимита. Свой вопрос (3–200 символов) — Workers AI получает каталог фактов и вопрос как недоверенный текст и возвращает только `{"factIds":[…]}` (0–3 известных ID); пустой список → «В данных этого матча ответа на этот вопрос нет»; любой другой ответ отбрасывается.
- Ставки («на кого ставить», кэф, фора, тотал, П1/П2, «заработать») — отказ до данных, лимитов и LLM.
- Лимиты: пользователь — `MATCH_QUESTIONS_USER_HOURLY_LIMIT` (10/час, счётчик в ответе), сервис — `MATCH_QUESTIONS_DAILY_LIMIT` (500/сутки, `claimDailyBudget`), плюс 12 запросов/мин на аккаунт. Кеш ответа: `ask:v1:{fixtureId}:{analysisVersion}:{хеш каталога}:{хеш нормализованного вопроса}` на сутки.
- Mini App: блок «💬 Спросить про матч» под «AI · простыми словами» (ленивый модуль `match-questions.js`).
Решения:
- Выключатель — `MATCH_QUESTIONS_ENABLED` + общие `analysisEnabled`/`maintenanceMode` из runtime controls; отдельный флаг в `runtime_controls` требует миграции (как и для задачи 5, см. «Идеи»). Переменные только в `.env.example` (значения по умолчанию в коде), `wrangler.jsonc` не трогал.
Осталось / внимание:
- Ревизия ассетов — launch97 (как и в #834: кто сольётся вторым — поднимет до launch98).
## 2026-10-11 — Claude — Фоновые задачи через GitHub Actions
PR: [#838](https://github.com/TRAP44/football-analytics-cloudflare/pull/838), ветка `claude/cron-runner`
Причина: на Workers Free у cron-запуска 10 мс CPU — с 9.10 ни один из 237 запусков не завершился (`scheduled_job_leases`, статус `running`); напоминания, уведомления, сводка, разбор после матча и задача 2 не работали. Оплата Workers Paid из РФ затруднена — Сергей выбрал вариант А.
Сделано:
- `scripts/cron-runner.js` вызывает тот же `scheduled()` из `src/worker.js` в Node 22: слот выравнивается до 5 минут (задержки GitHub), ждёт все `waitUntil`, таймаут 10 мин, выход 1 при упавшей задаче или если задачи не запускались; секреты вырезаются из вывода. В env воркера попадают только переменные из `wrangler.jsonc` и список разрешённых ключей.
- `.github/workflows/cron-runner.yml`: раз в 5 минут + ручной запуск, только `main`, окружение `background-jobs` (секреты окружения), `permissions: contents: read`, actions по SHA.
- `wrangler.jsonc`: `crons: []` — один исполнитель (общая блокировка `cron-global`).
- `privileged-access-audit`: разрешённые ключи для этого workflow + обязательное окружение `background-jobs` для задач с секретами.
Осталось / внимание:
- До слияния Сергей создаёт окружение `background-jobs` (только `main`) и кладёт туда ключи (инструкция в PR). Без ключей запуск падает с понятной ошибкой.
## 2026-10-11 — Claude — Ревью Codex старых PR (#806, #817, #825)
PR: [#837](https://github.com/TRAP44/football-analytics-cloudflare/pull/837), ветка `claude/review-fixes-806-825`
Сделано:
- #825, P1: при сбое истории анализов пользователь с ограниченным Weekend Pass проходил мимо защиты и тратил использование Pass на перепроверку. Теперь мимо защиты проходит только безлимитный Pass (`usageLimit == null`, как и в `reserveEntitlementUsage`); ограниченный получает сохранённый анализ без списания.
- #806, P2: метка «Пропустить ставку» из старого кеша в LIVE — уже исправлено в #819 (`neutralSignalText` по коду сигнала); добавлен регрессионный тест.
- #817 — замечаний нет.

## 2026-10-11 — Claude — Задача 7: пробелы разбора после матча
PR: [#834](https://github.com/TRAP44/football-analytics-cloudflare/pull/834), ветка `claude/post-match-review-gaps`
Проверено: `buildPostMatchReview` (сервер), `postMatchReviewHtml` (Mini App), `botPostMatchReviewText` (бот) — состояния «сравнение есть», «нет снимка», «ждём итог»; события и статистика API-Football.
Найдено и закрыто:
- исходы «П1/Н/П2» в «До матча / Факт» и в тексте итога → «Победа {команда}» / «Ничья»; сохранённые раньше разборы с П1/П2 Mini App переводит в слова сама;
- заголовок «POST-MATCH AI REVIEW» → «🧠 ПОСЛЕ МАТЧА»; «settlement» в заметке калибровки → по-русски;
- без предматчевого снимка блок был пустым — теперь сервер считает наблюдаемые факторы (удаление, xG, удары в створ, ранний гол, владение) и Mini App/бот их показывают; без счёта факторы не выдумываются;
- незабитый пенальти (событие Goal / Missed Penalty) считался «ранним голом»; вторая жёлтая не считалась удалением;
- длинные названия команд не вылезают из блока «До матча / Факт».
Осталось / внимание:
- Ревизия ассетов — launch97. Почти у всех матчей сейчас нет предматчевого снимка: `model_predictions` пополняется задачей 2, а cron на Free не доходит до конца (см. «Идеи»).

## 2026-10-11 — Claude — Ревью #829: без рынка в «пропущено» и «рисках»
PR: [#833](https://github.com/TRAP44/football-analytics-cloudflare/pull/833), ветка `claude/hide-odds-warnings-main` — перенос #832 (его слили в ветку #831 до перенацеливания, в `main` он не попал)
Сделано:
- `providerDataReliabilitySummary` (`src/provider-data-runtime.js`) больше не пишет предупреждений про `odds`/`liveOdds` («Линия 1X2 …», «Live-коэффициенты: …»); метаданные этих блоков остаются, доверие они по-прежнему не повышают.
- `analysis-runtime.js`: предупреждения надёжности фильтруются `isBettingText` до `dataPolicy.skipped` и `risks`.
- Mini App: `neutralTextList` скрывает рыночные строки в уже сохранённых разборах — «Что было пропущено», «Основные риски» и факторы краткой сводки.
Осталось / внимание:
- Ревизия ассетов — launch96. Урок: стек PR сливать по одному — после слияния нижнего дождаться, пока верхний перенацелится на `main`.

## 2026-10-11 — Claude — Задача 2: вероятности на карточках главных матчей дня
PR: [#831](https://github.com/TRAP44/football-analytics-cloudflare/pull/831), ветка `claude/precompute-probabilities`
Сделано:
- Системный вход анализа `analyzeFixtureForSystem` (`src/analysis-runtime.js`): тот же конвейер, блокировка матча и бюджет провайдера, но без квоты, прав/pass, истории и событий роста пользователя; данные — как у бесплатного режима. Если свежий анализ уже в кеше — только фиксирует первый снимок в `model_predictions`.
- Фоновое задание `src/prematch-prediction-job.js` в cron (под lease): раз в 30 мин берёт кешированную ленту на сегодня/завтра, выбирает предстоящие главные матчи (избранные команды пользователей → топ/featured → интерес → время), отбрасывает те, у которых **уже есть строка** в `model_predictions`, и считает до 2 за запуск, до 20 в сутки (`claim_provider_request`). Перед решением подтягивает общий снимок квоты провайдера; на FREE ждёт, пока сегодняшний остаток ≥ 60; cooldown / минутный лимит / 429 — тихий пропуск или остановка. Одна агрегированная запись `ops_events` за запуск с расчётом.
- `/api/matches`: для незавершённых матчей ленты добавляет провалидированные `aiProbabilities` из `model_predictions` (сумма 98–102), независимо от истории; кеш на 60 с; сбой — лента без поля.
- Mini App: карточка ленты и «Главный матч» рисуют полоску из ленты, если матч ещё не разобран, с подписью «✦ Оценка модели до разбора».
Осталось / внимание:
- Ревизия ассетов — launch95. Настройки — `PREMATCH_PREDICTIONS_*` в `wrangler.jsonc`/`.env.example`.
- По ревью Codex: RPC `claim_provider_request` молча режет окно до 3600 с, поэтому «суточный» лимит был часовым. Новый `src/daily-budget-claim.js` собирает сутки из 24 часовых корзин со стабильными ключами (`prefix:hHH`, ≤24 строк на префикс) и суммирует сегодняшние `request_count`. Применено к заданию (`prematch-predictions`) и к уже слитому AI-объяснению (#830): сервис — настоящие сутки (`ai-explain-global`), пользователь — честно «в час» (`AI_EXPLANATION_USER_HOURLY_LIMIT`, 6).
- По второму ревью Codex: обогащение `/api/matches` вероятностями ждёт Supabase не дольше 1,5 с (сбой/таймаут кешируется на 15 с), лента уходит без поля; сырой резерв ленты в задании классифицирует турнир через `normalizeCompetition` (молодёжь/товарищеские/низшие → не считаются, сбой классификатора → пропуск).
- По третьему ревью: суточный потолок задания проверяется (`peekDailyBudget`, без списания) до загрузки ленты; кандидаты берутся из полного пакета матчей дня (`provider-fixtures:<date>:v1`, свежий → устаревший кеш), а записи нормализованной ленты (≈120 матчей) его только дополняют — избранная команда вне ленты не теряется; сеть — лишь если для даты нет ни кеша, ни ленты. Избранные ищутся только по командам допустимых матчей (до 4000).

## 2026-10-11 — Claude — Задача 5: AI-объяснение «простыми словами»
PR: [#830](https://github.com/TRAP44/football-analytics-cloudflare/pull/830), ветка `claude/ai-explanation`
Сделано:
- `src/match-explanation-runtime.js`: каталог фактов из провалидированного анализа (лид по вероятностям модели, форма, очные встречи, потери, уверенность, полнота данных, составы, голы). Текст и роль (`lead`/`support`/`risk`/`caveat`) каждого факта задаёт сервер; роль «за/против» — относительно лидера модели. LLM (Workers AI, `@cf/meta/llama-3.1-8b-instruct-fp8-fast`) получает каталог и возвращает только `{"factIds":[…]}`; любой другой ответ (свободный текст, неизвестные/повторные ID, лишние поля, связки/роли, неверное количество, не-лид первым) отбрасывается целиком → порядок по умолчанию.
- `GET /api/match-explanation?fixtureId=` — только для тех, у кого матч в истории (как `/api/history-analysis`), из сохранённого анализа, без расхода лимита анализов. Лимиты Workers AI: на пользователя и на сервис в сутки (`claim_provider_request`), таймаут 4 с, кеш выбора по `fixtureId + analysisVersion + SHA-256 каталога` на сутки.
- Mini App: блок «🧠 AI · простыми словами» над «Что важно перед матчем» (ленивый модуль `match-explanation.js`), честная подпись «Порядок фактов выбрал AI» / «Базовый порядок фактов».
- `wrangler.jsonc`: биндинг `"ai": {"binding":"AI"}` и `AI_EXPLANATION_*`; без ключей и секретов.
Решения:
- Выключатель — `AI_EXPLANATION_ENABLED` (переменная) + общий `analysisEnabled`/`maintenanceMode` из runtime controls. Отдельный флаг в `runtime_controls` требует миграции Supabase — вынесено в «Идеи».
Осталось / внимание:
- Ревизия ассетов — launch94. Реальный расход нейронов виден в панели Cloudflare после деплоя; оценка — в PR.

## 2026-10-11 — Claude — Без рынка, шаг 2: бот, свежесть, новости, метод модели
PR: [#829](https://github.com/TRAP44/football-analytics-cloudflare/pull/829), ветка `claude/no-market-rest`
Сделано:
- Бот: кнопка news-impact «💹 Проверить рынок» → «⚠️ Риски матча» (callback `market` прежний, ведёт в «Риски матча» из #819); подпись действия «Рынок» → «Риски матча»; «следить за составами и рынком» → «… и новостями».
- Причины свежести анализа, темы новостей, подсказка поиска («…составы, рынок и судья»), текст «поделиться» в канале — без рынка. Метод модели: «Прогноз источника данных, …, очные встречи и другие источники…», «не может сдвинуть вероятности исходов…» вместо «1X2». Запасные тексты плана матча — «новости о составах и потерях» вместо «движения коэффициентов».
- Mini App: «Коэффициенты» убраны из «Покрытия данных» и «Происхождения данных»; заметка источника с «1X2/рыночный сигнал» заменяется нейтральной; старое описание метода модели из кеша переписывается.
Решения:
- Админка и служебные метки (качество модели «1X2», `odds-quality`, settlement) не менялись — их видит только владелец.
Осталось / внимание:
- Ревизия ассетов — launch93.

## 2026-10-11 — Claude — Без рынка: уведомления и преданализ
PR: [#828](https://github.com/TRAP44/football-analytics-cloudflare/pull/828), ветка `claude/no-market-notifications`
Сделано:
- Решение Сергея «убирай оба». Уведомления о движении рыночной вероятности (`important-change-notification-service`, «Расчётная рыночная вероятность…») не отправляются: сервис сразу возвращает `reason: market_notifications_disabled`, если в конфигурации нет `marketChangeNotificationsEnabled: true` (флаг используется только в тестах сервиса). Описание категории «AI-сигналы» в настройках: «Сильные изменения вероятностей модели без мелкого шума.»
- Преданализ на сервере: рыночный сигнал остаётся во входах модели, но не попадает в факторы («Коэффициенты П1 / Н / П2 поддерживает…»), таблицу источников, драйверы «Рынок и модель расходятся» / «Сила сигнала отличается от рынка», список «Что проверить» («Линия 1X2 отсутствует…») и заметки анализа.
- Mini App (для кешированных разборов): такие драйверы/строки/подсказки и пункты «факторов» и «рисков» со ставочными словами скрываются; веса модели — «… · прочие источники 40%» вместо «рынок 40%» (сумма остаётся честной).
Осталось / внимание:
- Ревизия ассетов — launch92. Оставшиеся упоминания рынка вне этой задачи — в «Идеях».

## 2026-10-11 — Claude — Аудит вёрстки на узких экранах
PR: [#827](https://github.com/TRAP44/football-analytics-cloudflare/pull/827), ветка `claude/layout-audit`
Сделано:
- Прогнал все основные экраны (главная, штаб матча — 4 вкладки, полный разбор — 7 вкладок, команда, турнир, «Мои команды», история, профиль) на 320/360/375/390/430px в тёмной и светлой теме со «стресс-данными»: длинные названия («Боруссия Мёнхенгладбах», «Вулверхэмптон Уондерерс»), счёт «10 : 12», длинный турнир. Автопроверка ищет текст, вылезающий за свою плашку/карточку, за экран и горизонтальный скролл (на версии до #826 она ловит баг со счётом).
- Исправлено: главная — круг «центра поля» привязан к счёту (раньше стоял на 46% высоты карточки, счёт оказывался в его верхней части), подпись под счётом — только тайм (минута уже есть в «LIVE 53′»); нижнее меню — «Мои команды» целиком на 320–390px; полный разбор — плашка «против» по ширине текста (была квадратом 48px под «VS»); профиль — выбор цвета в 2 колонки на 360px («Фиолетовый» вылезал).
- После правок автопроверка: 0 проблем на 320–430px.
Осталось / внимание:
- Ревизия ассетов — launch91. Очень длинные названия в шапке штаба переносятся по слогам (`hyphens: auto`) там, где браузер это умеет; иначе — как раньше.
- Скрипт аудита пока живёт вне репозитория (стенд Claude); при желании можно добавить в `scripts/`.

## 2026-10-11 — Claude — Счёт в шапке штаба по центру
PR: [#826](https://github.com/TRAP44/football-analytics-cloudflare/pull/826), ветка `claude/center-score-fit`
Сделано:
- Сергей прислал скриншот: в шапке штаба счёт «1 : 3» вылезал из тёмного блока вправо. Причина: в стиле SIGNAL (#807) счёт 44px, а узкие медиазапросы фиксировали колонку счёта 70–78px. Теперь в `.mr-hq-hero` колонка `auto`, блок по ширине счёта, размер `clamp(30px, 10.5vw, 44px)`, без переноса. Проверено замером на 360/375/404/430px для «1 : 3» и «10 : 12»: текст внутри блока и по центру.
Осталось / внимание:
- Ревизия ассетов — launch90.

## 2026-10-11 — Claude — Лимит не тратится при сбое истории
PR: [#822](https://github.com/TRAP44/football-analytics-cloudflare/pull/822), ветка `claude/launch-history-gate`
Сделано:
- `openLaunchFixture(id, 'analysis')`: если `/api/history` не загрузился (`state.historyLoadError`), вместо нового анализа открывается штаб матча с тостом — дневной лимит не тратится. Работает вместе со слитым #821 (сбой хранилища → 503).
Осталось / внимание:
- Ревизия ассетов — launch89; мержить после #820.

## 2026-10-11 — Claude — Перепроверка не списывает лимит при сбое истории
PR: [#825](https://github.com/TRAP44/football-analytics-cloudflare/pull/825), ветка `claude/recheck-history-outage`
Сделано:
- `userHasAnalyzedFixture(..., { strict:true })` пробрасывает сбой Supabase. `apiAnalyze`: если при перепроверке устаревшего анализа история не прочиталась (и нет pass), отдаётся сохранённый анализ с предупреждением «лимит не списан», `recheck.reasonCode = history_unavailable`; новый расчёт не запускается.
Решения:
- Найдено при разборе замечания Codex к #822 (кнопка «Полный AI-разбор» из бота, `handoff=1`): на клиенте этот путь историю не читает, а реальный риск списания был на сервере — сбой проверки «уже анализировал» считался как «нет».
Осталось / внимание:
- Только `src/`, с #820/#822/#823 не пересекается.

## 2026-10-11 — Claude — Серверные доработки по ревью #818–#820
PR: [#823](https://github.com/TRAP44/football-analytics-cloudflare/pull/823), ветка `claude/neutral-followups`
Сделано:
- Вердикт бота: при `betSignal.code = skip` команда не выдвигается в «Основной сценарий» — «Вывод: Без уверенного вывода» и нейтральная «Оценка модели» (замечание Codex к #819).
- `isBettingText` ловит все формы «рынок»; пояснение AI Timeline без «движения рынка»; лидер точки и `probabilityRanking` — «Хозяева/Ничья/Гости» вместо «П1/Н/П2».
- Голевые сценарии преданализа: «3+ гола в матче», «забьют обе команды» вместо «ТБ 2.5» и «обе забьют» (замечание к #820).
Осталось / внимание:
- В преданализе остаются драйверы и подсказки про рынок (`market_divergence`, «Линия 1X2 отсутствует…», summary «…или движение рынка…»): рынок — входной сигнал модели, решение о том, показывать ли это, — в «Идеях».

## 2026-10-11 — Claude — Ночная очередь: бот, исходы словами, честная история
PR: [#819](https://github.com/TRAP44/football-analytics-cloudflare/pull/819), [#823](https://github.com/TRAP44/football-analytics-cloudflare/pull/823), [#820](https://github.com/TRAP44/football-analytics-cloudflare/pull/820), [#821](https://github.com/TRAP44/football-analytics-cloudflare/pull/821), [#822](https://github.com/TRAP44/football-analytics-cloudflare/pull/822)
Сделано:
- #819 (только `src/`): бот и серверные тексты без ставочного языка. AI-вердикт — «🧠 AI · сценарии матча» (основной сценарий/альтернатива из вероятностей, голы словами, неопределённость, дисклеймер), кнопка «⚠️ Риски матча» (callback `match:market:` прежний). Нейтральные метки в «поделиться», сообщении после матча, поиске, уведомлении о перепроверке (рыночное изменение → одна строка «Обновились внешние данные матча»), live-подсказке, итоге матча и причине точки AI Timeline. Общие функции — `src/signal-wording.js` (`isBettingText`, `neutralSignalText`, `neutralOutcomeText`, `neutralReasonText`).
- #820: Mini App — «Хозяева/Гости» вместо «П1/П2» (в т.ч. «Главный сценарий» и таблица источников берут название по ключу исхода), «Вероятности исходов», «3+ гола» вместо «ТБ 2.5» в форме команды и в сценариях преданализа (кешированные тексты переписываются, ставочные карточки скрываются); summary live-подсказки и пояснение AI Timeline без рынка. Ревизия — launch88.
- #821 (только `src/`): `getHistory(..., { strict:true })`; `/api/history` и `/api/history-analysis` при сбое Supabase отвечают `503 HISTORY_UNAVAILABLE`, а не пустой список / «матча нет в истории».
- #822 (стек на #820): глубокая ссылка `action=analysis` при сбое истории открывает штаб матча, а не новый анализ (лимит не тратится). Ревизия — launch89.
- #818 доработан по ревью Codex: строгие маркеры в `verify-release`, токены ленивых импортов `match-pulse.js`/`ai-timeline.js`, без «Рыночного контекста» в AI Timeline, фильтр рыночных строк в live-подсказке.
Решения:
- Изменения `public/` конфликтуют по ревизии ассетов, поэтому #820 и #822 открыты стеком (база — предыдущая ветка). Серверные #819 и #821 — от `main`, независимы.
Осталось / внимание:
- Утром 11.10 Сергей слил #818, #819, #821. #820 перенесён на `main` (launch88), #822 — на #820 (launch89); мерж строго #820 → #822.
- Ревью Codex утром дали ещё 5 замечаний (P2 к #818/#819/#820, P1 к #822). Исправлено: клиентская часть — в #820, серверная — [#823](https://github.com/TRAP44/football-analytics-cloudflare/pull/823) (бот не выдвигает «основной сценарий» без вывода, тексты без рынка и П1/П2); P1 к #822 закрыт слитым #821.
- Ждёт решения Сергея: рыночные уведомления `market.movement` в «AI-сигналах» (см. «Идеи»).

## 2026-10-10 — Claude — Штаб матча без коэффициентов
PR: [#818](https://github.com/TRAP44/football-analytics-cloudflare/pull/818), ветка `claude/remove-center-odds`
Сделано:
- Убран свёрнутый блок «Рыночные данные» (live-коэффициенты П1/Н/П2 и «Движение рынка») во вкладке «Игра» штаба; удалены `centerMarketHtml`, `oddsMovementHtml`, `oddsQualityHintHtml`, `signedPp`.
- «Что изменилось» (`matchChangeNarrativeHtml`) больше не выводит «Изменилась оценка: … сдвиг расчётной рыночной вероятности»; пульс матча — «Рынок: Милан +2.4 п.п.» (`strongestOddsMovement` удалён).
- Из «Подробнее о данных» убраны «Рынок» в покрытии и «Коэффициенты» в свежести.
Решения:
- Сервер не менялся: коэффициенты по-прежнему собираются и проверяются (модель, мониторинг), но в Mini App их больше нет нигде. Строка «Коэффициенты» в режиме данных осталась только в админке.
Осталось / внимание:
- Ревизия ассетов — launch87. Следом — бот: «⛔ Лучше пропустить» и ставочный сигнал.

## 2026-10-10 — Claude — Исправление по ревью Codex #815
PR: [#817](https://github.com/TRAP44/football-analytics-cloudflare/pull/817), ветка `claude/feedback-inbox-stale`
Сделано:
- Codex (P2): если обновление раздела «Отзывы» падало после успешной загрузки, админка молча показывала старый список. Теперь над ним — «⚠️ Не удалось обновить отзывы: … Показана последняя загруженная версия.»; при следующем успешном обновлении пометка исчезает.
Осталось / внимание:
- Ревизия ассетов — launch86 (после слияния #816 с launch85 ветка подтянута на main).

## 2026-10-10 — Claude — «Сценарии матча» вместо «AI-инструктора»
PR: [#816](https://github.com/TRAP44/football-analytics-cloudflare/pull/816), ветка `claude/match-scenarios`
Сделано:
- Решение Сергея: переделать «AI-инструктор». В полном разборе вместо «Главной идеи: ТБ 2.5», «Решения», «Тотал 2.5/Обе забьют», «Условия отмены», «Что проверить перед решением» и заметки о рынке — карточка «AI · Сценарии матча»: основной и альтернативный сценарий словами («Победа Милан — 48%», «Ничья — 27%»), голы («Результативная игра: 3+ гола», «Забьют обе команды»), «Почему так», «Что может изменить картину», «Что уточнить до начала», «Что смотреть по ходу матча», уверенность/качество данных/проверка качества/судья.
- Тексты сервера проходят фильтр `scenarioText` (отбрасывает строки про коэффициенты, рынок, ставки, ТБ/П1/1X и «не форсировать решение») — сервер подмешивал «Сверить движение коэффициентов…» в нейтральные поля.
- Шапка разбора: «Хозяева / Ничья / Гости» вместо «П1 / Н / П2»; голевая модель: «3+ гола в матче», «Забьют обе команды»; вкладка «Рынок» (коэффициенты букмекеров) → «Модель» (только подробности расчёта); карточка коэффициентов в «Обзоре» удалена; старые ссылки `tab=market` ведут в «Модель».
Решения:
- Сервер (`aiInstructor`, `betSignal`, бот) не менялся — только отображение в Mini App. Вероятности — только если три значения корректны и в сумме ≈100.
Осталось / внимание:
- Ревизия ассетов — launch85. В штабе матча (вкладка «Игра») остался свёрнутый блок «Рыночные данные» (live-коэффициенты) — следующий кандидат на удаление. Бот всё ещё пишет «⛔ Лучше пропустить» и показывает сигнал — см. «Идеи».

## 2026-10-10 — Claude — Отзывы: уведомление админу и раздел в админке
PR: [#815](https://github.com/TRAP44/football-analytics-cloudflare/pull/815), ветка `claude/feedback-inbox`
Сделано:
- Каждый новый отзыв из «Сообщить о проблеме» уходит админам (`ADMIN_TELEGRAM_IDS`) в бота обычным текстом (без `parse_mode`): раздел, важность, «бета/пользователь», текст. Без id и имени.
- Защита от дублей: тот же текст того же пользователя за 10 минут не сохраняется и не пересылается повторно (двойное нажатие, повтор сети); общий потолок — 30 уведомлений в час на изолят; сбой Telegram не ломает ответ пользователю (`waitUntil`).
- `GET /api/admin/feedback` (только админ; префикс `/api/admin/` уже в реестре безопасности) — последние 100 отзывов за 1–90 дней. Новое чтение `readFeedbackOpsEvents` фильтрует `event_type in (beta_feedback,user_feedback)`, чтобы отзывы не вытесняла телеметрия.
- В `admin.html` — раздел «Отзывы» на виду (не в свёрнутых инструментах), грузится при открытии профиля админа; ленивый модуль `admin-feedback-inbox.js`; стили в `styles.css` (админка не грузит `premium-ui.css`).
Решения:
- Защита от дублей — в памяти изолята (мягкая): Cloudflare может держать несколько изолятов. Жёсткий лимит — серверный rate-limit 4/мин на аккаунт.
Осталось / внимание:
- Ревизия ассетов — launch84.

## 2026-10-10 — Claude — Обратная связь для всех пользователей
PR: [#814](https://github.com/TRAP44/football-analytics-cloudflare/pull/814), ветка `claude/feedback-for-all`
Сделано:
- `/api/beta-feedback` раньше принимал отзывы только от закрытой beta (`isClosedBetaUser`, админов тоже не пускал) — остальные получали 403 «только приглашённым тестировщикам», хотя кнопка «Сообщить о проблеме» видна всем в «Профиле».
- Теперь принимает любого пользователя с подтверждённым Telegram (`__telegramValidated`), иначе 401 `AUTH_REQUIRED`. Beta-участники пишутся как раньше (`beta_feedback`, в beta-метрики); остальные — `source:'feedback'`, `user_feedback`/`USER_FEEDBACK`, важность не выше `warning`. Лимит 4/мин на аккаунт уже был.
Решения:
- Публичные отзывы не смешиваются с beta-статистикой и не поднимаются до `critical`.
Осталось / внимание:
- Отзывы видны только в Supabase `ops_events` — следующий шаг: раздел «Отзывы» в админке/уведомление (см. «Идеи»). `public/` не менялся — ревизия ассетов не поднималась.

## 2026-10-10 — Claude — «Поделиться матчем»
PR: [#813](https://github.com/TRAP44/football-analytics-cloudflare/pull/813), ветка `claude/share-match`
Сделано:
- Новый ленивый модуль `public/modules/match-share.js`: `buildMatchShareText` (нейтральный текст: «хозяева 48% · ничья 27% · гости 25%», уверенность, счёт LIVE/итог), `shareMatch` (ссылка `/api/share-link` → Telegram composer `t.me/share/url?url=…&text=…` → `navigator.share` → буфер обмена).
- `shareAnalysis` в полном разборе теперь вызывает общий `shareMatchCard`; раньше в текст шли «П1/Н/П2» и метка сигнала («MatchRadar AI: ТБ 2.5»), а в Telegram — только ссылка с общей фразой.
- В шапке штаба — «↗ Поделиться» рядом с «Обновить» (в один ряд). Вероятности и уверенность — только из сохранённого разбора пользователя (`history.aiProbabilities`/`aiConfidence`), валидируются (три процента, сумма ≈100, уверенность 0–100).
Решения:
- `content` в share-link: `miniapp` для полного разбора (как было, чтобы не ломать аналитику), `center` для штаба. Стартовый параметр Telegram ограничен по длине — значения короткие.
Осталось / внимание:
- Ревизия ассетов — launch83. Серверный `telegramShareUrl` больше не используется клиентом (оставлен для совместимости).

## 2026-10-10 — Claude — Удалён скрытый «AI-центр» на главной
PR: [#812](https://github.com/TRAP44/football-analytics-cloudflare/pull/812), ветка `claude/remove-hidden-ai-center`
Сделано:
- Удалены `renderAiCenterSummary` («AI-центр»: «сигналов / лучше пропустить / высокий риск») и `renderAiFocus` («AI-рейтинг дня»), их контейнеры `#aiCenterSummary`/`#aiFocus` (index + admin), стили `.ai-center-*`/`.ai-focus-*`/`.ai-rank-*` и правило `.secondary-home-insight { display:none !important }`. Оба блока давно были спрятаны CSS-ом, но считались при каждой отрисовке главной.
- Тесты rc45/rc43 и `scripts/verify-release.js` закрепляли наличие этих блоков — теперь проверяют, что они не вернулись. Проверка рефери в верификаторе сохранена.
Решения:
- Удаляю, а не переписываю: на главной уже есть новый AI-слой (SIGNAL, «Для вас», лента), третий блок с тем же смыслом не нужен. Стартовый JS −4,4 КБ (500 381 из 515 000).
Осталось / внимание:
- Ревизия ассетов — launch82. В боте осталось «⛔ Лучше пропустить» — записано в «Идеи».

## 2026-10-10 — Claude — Главная: без повторов
PR: [#811](https://github.com/TRAP44/football-analytics-cloudflare/pull/811), ветка `claude/home-dedupe`
Сделано:
- Лента «радара» не повторяет матч, который уже показан плашкой «Для вас» прямо над ней (раньше любимая команда в LIVE шла подряд дважды, а потом ещё и в списке).
- Подсказка поиска «Команда или турнир» (была «Команда, матч или турнир» — обрезалась на телефоне).
Решения:
- У Codex закончился лимит ревью. Сергей: такие PR можно мержить, но Codex проверяет их, когда лимит вернётся. Список — раздел «Ждут ревью Codex» на доске.
Осталось / внимание:
- Ревизия ассетов — launch81. Удаление скрытого «AI-центра» — отдельной задачей (он закреплён тестами rc43/rc45).

## 2026-10-10 — Claude — Личные экраны: без ставочных меток, без дублей
PR: [#810](https://github.com/TRAP44/football-analytics-cloudflare/pull/810), ветка `claude/personal-screens-signal`
Сделано:
- «История» и лента «радара» на главной больше не показывают сохранённые метки сигнала («ТБ 2.5», «П1 · 52%»): только «разбор готов» / «без уверенного вывода» + уверенность. Тот же принцип, что в карточке штаба (#807).
- «Профиль»: «Тариф» и «Анализы сегодня» в верхней карточке скрыты (элементы остались — их заполняет `profile-summary.js`), их показывает блок «AI-лимит»; пока оплата выключена, там же скрыта ячейка «Подписка: нет активной». Счётчики — в один ряд.
- «Мои команды»: «Открыть →» в одном ряду с названием команды, а не отдельной строкой.
Решения:
- Полный разбор («AI-инструктор») не трогал — это на решении Сергея (см. «Идеи»).
Осталось / внимание:
- Ревизия ассетов — launch80. Скрытый CSS-ом «AI-центр» на главной (`renderAiCenterSummary`) всё ещё содержит «Лучше пропустить» / «сигналов» — записано в «Идеи».

## 2026-10-10 — Claude — «Команда» и «Турнир»: сломанные вкладки + стиль SIGNAL
PR: [#809](https://github.com/TRAP44/football-analytics-cloudflare/pull/809), ветка `claude/team-tournament-signal`
Сделано:
- **Баг (с #788):** `setTeamTab`/`setTournamentTab` переименовывали панели (`panel.id = 'team-panel-…'`), а при следующем вызове искали их по старым id → после первого переключения вкладки «Команды» и «Турнира» не меняли содержимое (на «Таблице» оставался список матчей). Заодно ломалось восстановление сети (`$('tournamentTablePanel')`). Теперь id постоянные, `aria-controls` указывает на настоящие панели.
- **Баг:** клик по команде в штабе матча вызывал `openTeam(teamId, btn)` с числом, а нужен объект → со штаба на страницу команды попасть было нельзя.
- Таблица турнира: «О» и «+/-» сразу после «И» — на телефоне очки больше не уезжают за край. Форма в шапке команды — плашками В/Н/П; «ОЗ» → «Забивали обе». Вкладки команды и турнира — «таблетка» как в штабе (44px).
Решения:
- Вкладки штаба и разбора ищут панели по `data-`атрибутам — их баг не затронул, не трогал.
Осталось / внимание:
- Ревизия ассетов — launch79. Следом: «Мои команды», «История», «Профиль» в стиле SIGNAL.

## 2026-10-10 — Claude — «Честность модели» на вкладке AI
PR: [#808](https://github.com/TRAP44/football-analytics-cloudflare/pull/808), ветка `claude/ai-track-record-hq`
Сделано:
- На вкладке «✦ AI» штаба, сразу под «Выводом AI», — карточка «Честность модели»: «Основной исход совпал в M из N проверенных матчей», полоса совпало/не совпало, метка выборки и ссылка на полную историю. Источник — существующий публичный протокол `/api/ai-track-record` (неизменяемые предматчевые прогнозы с подтверждённым итогом, кэш на сервере).
- Штаб сам грузит протокол, если он ещё не загружен, и перерисовывается после загрузки (общий хелпер `rerenderOpenMatchCenter`, им же пользуется загрузка истории).
- Пустые состояния: протокол недоступен → карточки нет; `available:false` → «ещё формируется»; 0 проверенных → «ещё нет матчей с подтверждённым итогом».
Решения:
- Без процента: протокол сознательно избегает «процента побед», показываю только счётчики из ответа. Счётчики ограничены (`matched ≤ verified`, `missed ≤ verified − matched`).
- «Не совпало» — нейтральный серый, а не красный: никакой «табло ставок» стилистики.
Осталось / внимание:
- Ревизия ассетов — launch78. Следом: остальные экраны в стиле SIGNAL; серверный признак `degraded` для `/api/history` (см. «Идеи»).

## 2026-10-10 — Claude — «Штаб матча»: вкладки и AI-вывод сверху
PR: [#807](https://github.com/TRAP44/football-analytics-cloudflare/pull/807), ветка `claude/match-hq-tabs`
Сделано:
- Разметка матч-центра вынесена из `app.js` в ленивый модуль `public/modules/match-center-view.js` (`renderMatchCenterView`), иначе не влезали в бюджет стартового JS. В `app.js` осталась обёртка `renderMatchCenter`, зависимости передаются через `deps`.
- Вкладки «✦ AI · Обзор · Игра/LIVE · Составы», по умолчанию открывается AI. Сверху карточка «✦ Вывод AI»: есть разбор — метка, риск, уверенность и кнопка полного разбора; нет — честно «AI ещё не разбирал этот матч» и кнопка запуска (до матча) или «AI-разбор до матча не запускался».
- Пустой блок «Недостаточно данных» больше не дублируется под «Умными инсайтами». Стадион, город и судья — одна строка вместо двух блоков.
- Тесты, которые читали `renderMatchCenter` из `app.js`, теперь читают `app.js` + модуль; проверки «details.open»/«match-center-more» переведены на вкладки.
Решения:
- Вероятности и коэффициенты по-прежнему не берутся из `d.probabilities`; рыночные данные — свёрнутым блоком во вкладке «Игра».
Осталось / внимание:
- Ревизия ассетов — launch77. Следом: точность модели (ai-track-record) на вкладке AI, остальные экраны в стиле SIGNAL.

## 2026-10-10 — Claude — Нейтральные формулировки AI + задача 5 на Workers AI
PR: ветка `claude/ai-neutral-wording`
Сделано:
- `src/signal-wording.js`: «Пропустить ставку» → «Без уверенного вывода» (`NO_CLEAR_SIGNAL_LABEL`). Старые подписи из истории, кеша разборов, поиска в боте и post-match нормализуются при выдаче (`publicSignalLabel`, `withPublicSignalLabel`), код сигнала `skip` не менялся.
- Бот: «🎯 Идея:» → «🎯 Вывод:», «не нужно искать ставку любой ценой» → «исход матча открыт»; дисклеймер в Mini App без «пропустить ставку». Предупреждения «не букмекерская рекомендация» оставлены намеренно.
- `TASKS_RU.md`, задача 5: решение Сергея — Cloudflare Workers AI через биндинг `AI` (бесплатная дневная квота, без ключа) → зависимость от задачи 0 снята.
Решения:
- Функции не убирал: «AI-инструктор» с сигналами «ТБ 2.5»/«обе забьют»/рынком остаётся, вынесено на решение Сергея в «Идеи».
Осталось / внимание:
- Ревизия ассетов — launch76. `verify:worker` локально нет (wrangler), проверит CI.

## 2026-10-10 — Claude — Янтарные логотип, иконка и аватар
PR: ветка `claude/brand-svg-amber`
Сделано:
- `public/assets/brand/matchradar-mark.svg`, `matchradar-avatar.svg`, `matchradar-wordmark.svg`: mint `#43E6A1` и синий sweep заменены на янтарь `#FBBF24` (кольцо, сектор) и белую дугу/точку сканера — иначе дуга сливалась с жёлтым кольцом. База — тёплый графит `#0A0D12`/`#13100A`. «AI» в wordmark — `#B45309` (читается на светлом фоне).
Решения:
- Форма знака не менялась, только цвета: узнаваемость сохраняется.
- Экран загрузки (замечание Сергея): до запуска `app.js` нет `data-accent`, и акцентом был цвет кнопок темы Telegram или зелёный `#22c55e`. В `<head>` `index.html` — маленький `<style>` только для `html:not([data-accent])`; `--brand-mint` в `public-shell.css` (свечение и полоска загрузки) теперь `var(--accent)`. Ревизия — launch75 (после #805).
Осталось / внимание:
- Аватар бота в Telegram Сергей меняет вручную через @BotFather: PNG 512×512 из `matchradar-avatar.svg` отдан ему в чате.
- Идея на доске от Codex про mint SVG закрывается этим PR.

## 2026-10-10 — Codex — Задача 1: ближайший матч любимой команды
PR: [#805](https://github.com/TRAP44/football-analytics-cloudflare/pull/805), ветка `codex/nearest-favorite-order`.
Сделано:
- До начала реализации перенесены собственные слитые строки #797, #799 и #801 в «Готово»; чужие строки сохранены.
- Сортировка теперь явно сравнивает наличие kickoffMs: LIVE → избранная команда → известное время раньше неизвестного → время → score. Убрана разность с Infinity, которая создавала нетранзитивный порядок.
- Добавлены шесть регрессионных тестов: все ветки, стабильность равных ключей, сохранение исключения предстоящих матчей без времени, 24 перестановки смешанных LIVE-кандидатов. Ассеты launch74.
Решения:
- TASKS_RU.md прочитан из ветки `claude/roadmap-tasks` открытого PR #802: файла ещё нет в main. Не переносили чужую документацию в этот PR.
- Отбор кандидатов, UI, provider-запросы и схема БД не изменены; новые проверки старой версии воспроизводят два падения, исправленная версия проходит.
Осталось / внимание:
- Node 22: npm ci, check, lint, release 569/569, полный набор 3749/3749; браузерный smoke 320–1280 px в трёх темах, verify:release, Worker dry-run, security:scan и security:privileged прошли.
- Ревью — Claude, merge — Сергей.

## 2026-10-10 — Claude — Главная в стиле SIGNAL (янтарь)
PR: [#803](https://github.com/TRAP44/football-analytics-cloudflare/pull/803), ветка `claude/home-signal-amber`
Сделано:
- По решению Сергея перенёс дизайн прототипа SIGNAL V2 (закрытый PR 781) на настоящую главную, но в янтаре «Стадиона»: шапка «Читай игру. Не только счёт.» с датой и реальными цифрами, карточка «Главный матч», нумерованные разделы, компактные карточки ленты (команды строками, счёт справа), блок «Мы объясняем изменения».
- Логика и разметка новых блоков — в ленивом модуле `public/modules/home-signal.js` (грузится после данных матчей): стартовый JS остаётся в лимите 515 КБ из `public-client-performance.test.js`.
- Починил старую проблему: на 320px поле поиска сжималось до «Команда, |».
- Починил баг «Стадиона»: при явно выбранной «Тёмной» теме акцент был старым зелёным (`:root[data-theme="dark"]` в `styles.css` сильнее по специфичности). Теперь янтарь и там.
Решения:
- «Главный матч» берётся только из загруженной ленты (LIVE → предстоящие → завершённые; featured, интерес, приоритет), не дублирует карточку «Для вас», открывает штаб матча и никогда не запускает AI-разбор сам.
- Все цвета — через токены темы, поэтому светлая/ocean темы и выбранный акцент работают; анимация радара выключается при reduced motion.
Осталось / внимание:
- Все действия карточек (Разобрать, Следить, напоминание, избранное) сохранены; изменена только раскладка через CSS в `#matches`.
- По ревью Codex: счётчики шапки больше не сверяются с `matchesMeta.date` (его проставляют уже после отрисовки) — показываются по факту применённого ответа; добавлен регрессионный тест.
- Ветка перенесена поверх #801 (наблюдение за матчами), его блок `#matchObservation` сохранён. Ревизия ассетов — launch73.
- Стартовый JS впритык к лимиту 515 КБ: хук ленивой загрузки ужат, следующему, кто добавит код в `app.js`, вероятно, придётся выносить что-то в ленивый модуль.
- `verify:worker` локально не запускался (нет wrangler в окружении), его проверит CI.

## 2026-10-10 — Codex — Наблюдение за матчами: интерфейс и существующие напоминания
PR: [#801](https://github.com/TRAP44/football-analytics-cloudflare/pull/801), ветка `codex/match-observation`.
Сделано:
- Список локально наблюдаемых матчей на главной: LIVE выше остальных, сохранённый матч не теряется вне текущей ленты, открыть штаб и убрать из списка.
- Кнопки наблюдения и существующего серверного Telegram-напоминания в Match Center. Загрузка напоминаний перед включением, блокировка кнопки до подтверждённого списка, обновление состояния после изменения.
- Новый модуль загружается лениво; ревизия launch72. Браузерный smoke проверяет заполненный список, длинные названия и действия.
Решения:
- Локальное наблюдение и серверное напоминание различаются явно; удаление из наблюдения не отключает уже включённое Telegram-напоминание. Управление напоминанием — отдельная кнопка в штабе до начала матча.
- Не создавали новый scheduler и не меняли серверные правила доставки: существующие reminder mutations / серверная защита повторов сохранены.
Осталось / внимание:
- События составов и результата и их настройки ещё не подключены к наблюдению; требуется отдельная серверная задача с проверкой доставки и дедупликации, без обещаний такой доставки в UI.
- Node 22: npm ci, check, lint, release 569/569, полный набор 3729/3729, security scan/privileged, verify:release, Worker dry-run; заполненный браузерный smoke 320–1280 px прошёл.
- Исправлено замечание CodeQL js/bad-tag-filter в test/match-observation.test.js: проверка регистронезависима и проверяет также верхний регистр SCRIPT.
- Ревью — Claude; merge — Сергей согласно AGENTS.md.

## 2026-10-10 — Claude — Очередь задач для Codex
PR: ветка `claude/roadmap-tasks`
Сделано:
- `docs/ai-team/TASKS_RU.md`: 8 задач по порядку (сортировка, вероятности для всех матчей, кривая по ходу матча, составы, LLM-слой, вопросы по матчу, разбор после матча) с ограничениями, критериями приёмки и тем, что НЕ делать. Те же строки добавлены в бэклог доски.
Решения:
- LLM только пересказывает проверенные факты; любое число в тексте должно быть во входных данных, иначе показывается шаблон.
- Задача 5 (секрет `LLM_API_KEY`) ждёт задачи 0: секрет в панели Cloudflare блокирует деплой, пока не поправлен гейт (нужно явное «да» Сергея).
Осталось / внимание:
- Ревью каждого PR от Codex — Claude; merge — только Сергей.

## 2026-10-10 — Codex — Персональный первый вход и ближайший матч
PR: [#799](https://github.com/TRAP44/football-analytics-cloudflare/pull/799), ветка `codex/personal-first-entry`.
Сделано:
- Подсказка предлагает выбрать 1–3 команды через существующий поиск и серверное избранное; показывает число уникальных команд, остаётся доступной после поиска и скрывается после явного пропуска либо выбора трёх команд.
- Персональная карточка выбирает LIVE, затем любимую команду и ближайшее начало; просмотренные команды остаются запасным вариантом. Открывается Match Center без автоматического списания AI-квоты.
- Ревизия фронтенда поднята до launch71. Старый PR #640 закрыт по явному указанию Сергея: его основные изменения уже перенесены через #642 и #644.
Решения:
- Без новых provider-запросов, миграций или ограничения общего числа избранных команд. Подборка использует только текущий загруженный список матчей, не обещает календарь за пределами этой выборки.
Осталось / внимание:
- Node 22: npm ci, syntax, lint, release-critical, полный набор 3725/3725, security scan/privileged, verify:release и Worker dry-run прошли.
- Браузерный smoke прошёл для 320–1280 px и трёх тем; нужен CHROME_PROXY_SERVER=http://proxy:8080 в этой облачной среде. TLS-проверка не отключалась.
- Merge выполняет Сергей согласно AGENTS.md; ревью — Claude.

## 2026-10-10 — Claude — Ретранслятор API-Football на Supabase
PR: ветка `claude/football-relay-base-url`
Сделано:
- Воркер умеет ходить в API-Football через необязательный базовый адрес `API_FOOTBALL_BASE_URL` (только https, без query/учётных данных; иначе — прямой провайдер). В `wrangler.jsonc` задан адрес функции `football-relay` в Supabase.
- Исходник функции — `supabase/functions/football-relay/index.ts`: прозрачный GET-ретранслятор, белый список путей, ключ приходит в запросе и нигде не хранится.
Решения:
- Причина: Cloudflare Workers ходят с общего исходящего IP, API-Football режет такие запросы до учёта квоты ключа (подтверждено поддержкой). Проверка: через Supabase приходит полный список матчей.
- Функцию Сергей развернул вручную в Supabase (JWT verification выключен): авто-режим развёртывание заблокировал. Откат: очистить `API_FOOTBALL_BASE_URL` в `wrangler.jsonc`.
Осталось / внимание:
- Функция не в CI: изменения кода функции нужно заново вставлять в Supabase вручную.
- Если Supabase-адрес тоже начнёт отклоняться, запасной вариант — собственный сервер (VPS) с постоянным IP.
- Ревью — Codex, merge в `main` — только Сергей.

## 2026-10-10 — Codex — Янтарный акцент в бренд-спецификации
PR: [#797](https://github.com/TRAP44/football-analytics-cloudflare/pull/797), ветка `codex/brand-spec-amber`
Сделано:
- В `MATCHRADAR_BRAND_SPEC_RU.md` закреплены янтарный / жёлтый неон как основной акцент, тёмная «стадионная» база и чистый современный AI-стиль; mint больше не описывается как главный цвет.
- Уточнены роль холодного синего как дополнительного цвета, акцент знака и статус текущих ассетов.
- Задача перенесена на ревью Claude; на доске отдельно отмечены SVG со старым mint-акцентом.
Решения:
- Следуем утверждённому в `AGENTS.md` направлению Telegram-канала; основной цвет меняется только по решению Сергея.
- Этот PR обновляет документацию. Изменения ассетов и интерфейса требуют отдельной задачи.
Осталось / внимание:
- На копии актуального `main` прошли `npm run check`, `npm run lint`, `npm run test:release` и `npm test` (52 и 366 файлов тестов соответственно), а также `git diff --check`.
- Проверки выполнены на доступном Node 24.19.0; Node 22 в окружении отсутствует. `npm ci` не выполнен: недоступен сетевой прокси; офлайн-кеш также неполон. Quality пропускает PR с изменениями только Markdown.
- Ревью — Claude, merge в `main` — только Сергей.

## 2026-10-10 — Claude — Настройка совместной работы Claude + Codex
PR: ветка `claude/ai-team-setup`
Сделано:
- Общие правила для обоих ассистентов в `AGENTS.md` (Codex читает его сам, Claude — через `CLAUDE.md`).
- Доска задач `docs/ai-team/BOARD.md`, этот журнал и шаблон PR.
- Инструкция для Сергея: `docs/ai-team/HOW_TO_RU.md`.
Решения:
- Мержит в `main` только Сергей: merge в `main` сразу запускает production-деплой.
- Ветки разделены префиксами `claude/` и `codex/`; каждый PR проверяет другой ассистент.
- Основной цвет — янтарный, как в канале (приоритет над mint в brand spec).
- По ревью Codex: `BOARD.md` и `HANDOFF.md` — координационные файлы, их можно менять параллельно (только свои строки, при конфликте сохранять обе версии).
- По ревью Codex: в `HOW_TO_RU.md` исправления поручаются только автору PR (`@codex …` — только для PR от Codex).
Осталось / внимание:
- `MATCHRADAR_BRAND_SPEC_RU.md` ещё описывает mint — задача в бэклоге.
