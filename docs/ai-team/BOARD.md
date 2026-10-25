# Доска задач MatchRadar

Общая доска для Сергея, Claude и Codex. Обновляется в каждом PR.

Формат строки: `- [ ] Задача — **исполнитель** — ветка/PR — заметка`

Исполнитель: **Claude**, **Codex** или **Сергей**. Если исполнитель не указан — задачу может взять любой, но сначала впиши себя.

## Бэклог (Сергей расставляет приоритет сверху вниз)

- [ ] Бот: живое табло одним сообщением — «Следить» → одно сообщение со счётом, минутой, голами и удалениями обновляется весь матч (editMessage), после свистка — итог в 2–3 строки — Сергей 15.10 (массовый продукт), №2 после inline.
- [ ] Бот: «Угадай счёт» против AI с общим рейтингом — перед главными матчами угадать счёт кнопками, очки, еженедельный топ-10 игроков MatchRadar в канале; без ставок и денег — Сергей 15.10, №3.
- [ ] Бот для публичных футбольных групп — админ фан-группы клуба добавляет бота: голы и итоги матчей клуба с кнопкой на разбор — Сергей 15.10, №4 (после inline).
- [ ] Канал: опрос «Кто победит?» перед топ-матчем → оценка AI → итог; публикация кнопкой из черновика в личке Сергея — Сергей 15.10, №5.
- [ ] Приветствие новичка после /start: сразу 3 главных матча дня и кнопка «Выбрать любимую команду» (избранное сейчас у 2 человек) — Сергей 15.10, №2.
- [ ] Надёжность фоновых задач: таймауты RPC Supabase у lease (claim/renew/complete_scheduled_job) — повтор и запас по времени, чтобы расчёты/уведомления не пропускались — Сергей 15.10, №3.
- [ ] Еженедельный отчёт Сергею: новые люди, вернувшиеся, что открывают (по growth_events) — Сергей 15.10, №5.
- [ ] Mini App: единый визуальный стиль — убрать эмодзи из заголовков (⚽ Голы, ⚠️, 🧩) и старые панели с другим размером шрифта, всё в неоновые карточки (~4 ч) — UX-ревью Claude 15.10.

## В работе

- [ ] Уведомления: последняя проверка подписки/избранного и настроек перед Telegram — **Codex** — `codex/notification-live-subscription-check`; изменения после discovery/claim, strongDB, failcloseddefer, прежниеCAS/dedupe.








































































## На ревью

- [ ] Точность владения отправкой уведомлений — **Codex** — [PR #1016](https://github.com/TRAP44/football-analytics-cloudflare/pull/1016), `codex/notification-claim-precision`; strict lossless6digits, прежниеCAS/dedupe, release870/full4664/independentreviewpassed; fresh+upgrade realDBproof иCI→deploy проверяются.

- [ ] Переход из библиотеки к просмотру без раскрытия результата — **Codex** — [PR #1015](https://github.com/TRAP44/football-analytics-cloudflare/pull/1015), `codex/watch-library-spoiler-entry`; launch142, privatehide до HTTP, parallelprefs/failedACKhidden/retry, ordinaryentry/noautoplay/cancel. Localrelease846/full4660/nativebrowser/independentreview passed; CI→deployproof проверяются.

- [ ] Библиотека доступного просмотра с главной — **Codex** — [PR #1014](https://github.com/TRAP44/football-analytics-cloudflare/pull/1014), `codex/watch-library-entrypoint`; launch141, lazy0startup, oneDBread, explicitcountry/noURL/noSpoilers, checkedmatchentry/cancelledimport/heldHTTPexpiry. Release846/full4660/nativebrowser/independentreview passed; CI/indexpublication/deploy проверяются.

- [ ] Фактический формат описания J.LEAGUE и официальный 12-й тур первых матчей — **Codex** — [PR #1013](https://github.com/TRAP44/football-analytics-cloudflare/pull/1013), `codex/observed-jleague-highlight-format`; actualGoogle+officialfixturepages, 39focused/release840/full4654/independentreview passed; ждёмCI→positivepublication→deployproof.

- [ ] Привязка наблюдавшихся обзоров по независимым данным матча в описании — **Codex** — [PR #1012](https://github.com/TRAP44/football-analytics-cloudflare/pull/1012), `codex/highlights-description-evidence`; actualtitle+matchspecificdesc, archive/category/promotion guards, release839/full4653/38focused/independentreview passed; actualpositivepublication не подтверждена.

- [ ] Автоматические официальные короткие обзоры матчей — **Codex** — [PR #1011](https://github.com/TRAP44/football-analytics-cloudflare/pull/1011), `codex/official-match-highlights`; canonicalseason/mandatoryround, uploads+durablemarker/failureisolation, replay coexist. Localrelease835/full4649/nativebrowser/independentCodexreview passed; actualGooglepublication и CI/deploy проверяются.

- [ ] Непрерывный просмотр при обновлении каталога — **Codex** — [PR #1010](https://github.com/TRAP44/football-analytics-cloudflare/pull/1010), `codex/watch-background-revalidation`; launch140, same-player renewal, independent expiry/revocation, no autoplay, privacy drafts. Localrelease825/full4639/nativebrowser и independent Codexreview прошли; CI/deploy проверяются.

- [ ] Режим просмотра без спойлеров и продолжение записи — **Codex** — [PR #1009](https://github.com/TRAP44/football-analytics-cloudflare/pull/1009), `codex/watch-without-spoilers`; launch139, separate versioned watchingstate, min-goaldelay/pause, board/result guards, resume/startover. Localrelease818/full4632/nativebrowser+independentreview прошли; CI/deploy ещё проверяются.

- [ ] Официальные завершённые эфиры как «Полная запись» в Mini App — **Codex** — [PR #1008](https://github.com/TRAP44/football-analytics-cloudflare/pull/1008), `codex/official-match-replays`; live→replay до7д,24focused/release807/full4621/nativebrowser прошли, independentreview без blockers; actualtwoFT sourcesverified, CI→deploy→publication ещё проверяются.

- [ ] Разблокировать выпуск #1006: security patch undici7.30.1 для ночных advisories — **Codex** — [PR #1007](https://github.com/TRAP44/football-analytics-cloudflare/pull/1007), `codex/undici-security-7301`; audit0/release804/full4618, independent review чистый; exact override+lock+securityfloor. Actual automation searched→cached и отказ завершённым эфирам подтверждены; ожидается CI→production.

- [ ] Автоматический поиск и публикация официальных эфиров без PR на каждый матч — **Codex** — [PR #1006](https://github.com/TRAP44/football-analytics-cloudflare/pull/1006), `codex/automatic-official-watch`; J1 source policy, quota guard, exact canonical matching, removal/revocation; независимое review без блокеров, local ci/check/lint/release802/full4616 + дополнительные negative tests/Chromium прошли. CI и actual auto refresh перед заявлением о выпуске.

- [ ] Надёжное автообновление каталога просмотра через существующие часы Cloudflare → Background Jobs — **Codex** — [PR #1005](https://github.com/TRAP44/football-analytics-cloudflare/pull/1005), `codex/watch-refresh-dispatch`; local full4609/release796, независимое review без блокеров; отдельный GitHub schedule не запускался более часа. Parallel watch job изолирован от уведомлений и их ключей; после выпуска проверить настоящий очередной CF dispatch.





























































- [ ] LIVE-табло: аудит очереди, повторных уведомлений, 429 и таймаутов (Сергей 16.10) — гол не теряется, когда табло застыло (устаревшие данные или отложенная правка): подавление уведомления о голе только для актуального табло (`shown.h` + снимок ≤15 мин); удалённое человеком табло (`s:'g'`) возвращает уведомления о голах; пауза 429 от момента ответа; сбой сохранения отметок не сдвигает курсор мимо людей; отложенные правки в `deferred` — **Claude** — [PR #932](https://github.com/TRAP44/football-analytics-cloudflare/pull/932), ветка `claude/scoreboard-audit` — ревью: Codex



- [ ] Готовый разбор: задержка по замерам БД (Issue #923) — baseline и 4 пары последовательных прогонов на GitHub-стенде; фоновые события роста (`full_ai`) пакетами: REST на 1000 разборов 6013 → ~4040 (−33%), p95 −14% в среднем, но в пределах разброса машин — ускорение не доказано; цель 2 с не достигнута, следующее узкое место — 3 последовательных запроса ответа (2 claim + квота); аннотации замеров в GitHub, нативный стенд для сред без реестров — **Claude** — [PR #928](https://github.com/TRAP44/football-analytics-cloudflare/pull/928), ветка `claude/cached-analysis-latency` — ревью: Codex
- [ ] Бот: кнопки и сценарии (Issue #922) — «Мои команды» страницами по 10 с «➕ Добавить» и «☆ Убрать»; «Составы и потери» из центра матча без AI-квоты; короткие ошибки без HTTP/Supabase (детали — в ops); web_app-кнопки в группах и каналах → ссылка в бота; выбор клубов не обещает напоминаний; подборка показывает состояние и одно действие, сбой записи — не успех; AI-ответ без «уверенность /100» и «качество данных %»; inline отличает «поиск недоступен» от «не найден» — **Claude** — [PR #927](https://github.com/TRAP44/football-analytics-cloudflare/pull/927), ветка `claude/bot-buttons-fixes` — ревью: Codex — слит 16.10


- [ ] LIVE-табло: надёжность (Issue #921) — свежесть снимка ≤10 мин без отката счёта, pending/unknown без повторной отправки и с обычными уведомлениями о голах, курсор по favorites, честная очередь, пачки отметок, пауза по 429, одна ops-запись; замер 1000/10000 и схема таблицы `scoreboard_deliveries` (миграция — отдельная подзадача) в `docs/LIVE_SCOREBOARD_RU.md` — **Claude** — [PR #925](https://github.com/TRAP44/football-analytics-cloudflare/pull/925), ветка `claude/scoreboard-reliability` — ревью: Codex — слит 15.10
- [ ] Бот: меню из 2 кнопок (Сергей 15.10: «Матчи»/«LIVE» дублировали кнопку приложения) — «⭐ Мои команды», «⚙️ Уведомления»; старые «Матчи»/«LIVE» отвечают кнопкой в приложение — **Claude** — ветка `claude/bot-menu-two-buttons` — ревью: Codex
- [ ] Бот: живое табло любимых команд (Сергей 15.10) — одно сообщение на матч: счёт, минута, перерыв обновляются в нём же каждые 5 минут, после свистка — «Матч завершён» и кнопка «Итог AI»; получатели — избранное + включённые уведомления о голах; новых запросов к источнику нет (кеш матчей дня); выключатель `FAVORITE_SCOREBOARD_ENABLED=false` — **Claude** — [PR #919](https://github.com/TRAP44/football-analytics-cloudflare/pull/919), ветка `claude/favorite-live-scoreboard` — ревью: Codex — слит 15.10
- [ ] Бот: выбор любимых команд сразу после /start (Сергей 15.10) — в личке у пользователя без избранного после приветствия 15 популярных клубов кнопками (★ отмеченные, «✅ Готово» → «Мои команды»), «⭐ Мои команды» без избранного открывает тот же выбор; другой клуб — названием в чат; нажатие только добавляет (повтор безопасен) — **Claude** — [PR #918](https://github.com/TRAP44/football-analytics-cloudflare/pull/918), ветка `claude/bot-favorite-picker` — ревью: Codex — слит 15.10
- [ ] Бот: меню из 4 кнопок (Сергей 15.10) — «⚽ Матчи» и «🔴 LIVE» открывают приложение (web_app, LIVE — с фильтром), «⭐ Мои команды», «⚙️ Уведомления»; «📰 Новости» и «💎 Тарифы» убраны (старые кнопки → «Меню обновлено», /plans работает); старые «Матчи»/«LIVE»/«/today»/«/live» отвечают кнопкой в приложение и новым меню — **Claude** — [PR #917](https://github.com/TRAP44/football-analytics-cloudflare/pull/917), ветка `claude/bot-menu-cleanup` — ревью: Codex — слит 15.10
- [ ] Inline-поиск под задачи людей (Сергей 15.10): пустой запрос — сначала матчи любимых команд пользователя, затем главные матчи дня по важности (без низших лиг сверху); поиск по команде (рус/лат), турниру и коротким названиям («АПЛ», «ЛЧ», «РПЛ», «Серия А»), стране («Испания»); до 10 результатов; страна у одноимённых лиг — **Claude** — [PR #916](https://github.com/TRAP44/football-analytics-cloudflare/pull/916), ветка `claude/inline-top-matches` — ревью: Codex — слит 15.10
- [ ] Inline-карточка: главные матчи дня по важности ленты (Сергей 15.10: «матчи странные» — наверх лезли идущие матчи Уганды, Киргизии, Саудовской лиги); LIVE поднимается только у турниров высшего уровня; страна у одноимённых лиг («Premier League · Уганда») — **Claude** — ветка `claude/inline-top-matches` — ревью: Codex
- [ ] Inline-карточка: поиск по последнему снимку ленты дня (кэш ленты живёт 1 минуту — inline почти всегда был пустой); у устаревшего снимка LIVE без минуты и счёта; тесты не зависят от даты — **Claude** — [PR #915](https://github.com/TRAP44/football-analytics-cloudflare/pull/915), ветка `claude/inline-stale-feed` — ревью: Codex
- [ ] «Поделиться матчем» в боте (бэклог №1, Сергей 15.10): по кнопке бот присылает карточку для пересылки — команды, турнир, время МСК / счёт, AI-вывод только об исходе (без «3+ гола», «обе забьют», коэффициентов), личная реферальная ссылка в тексте и кнопки только-ссылки («Открыть матч в MatchRadar», «↗ Отправить в чат»), чтобы пересланная копия работала у друга; кнопка добавлена и в карточку будущего матча из поиска; друг по ссылке → бот сразу на этом матче, приглашение за поделившимся (+1 разбор обоим по правилам #868). Без миграций и прод-настроек — **Claude** — [PR #914](https://github.com/TRAP44/football-analytics-cloudflare/pull/914), ветка `claude/bot-share-match-referral` — ревью: Codex
- [ ] Бот: карточка матча в любом чате Telegram (inline-режим, Сергей 15.10: «продукт для массы людей») — `@бот Реал` в любом чате/группе → карточка матча (статус, проверенные проценты AI до матча) с кнопкой «Открыть AI-разбор»; ссылка несёт реф-код автора (`inline_share`); пустой запрос — главные матчи дня; кириллица через план поиска команды; лимит 20 запросов/10 с — **Claude** — [PR #913](https://github.com/TRAP44/football-analytics-cloudflare/pull/913), ветка `claude/bot-inline-match-card` — ревью: Codex. Нужно включить inline-режим в BotFather (`/setinline`).
- [ ] Бот без ставочных рынков: в AI-вердикте вместо «3+ гола · N%» и «Забьют обе команды · N%» — ожидаемые голы; в «Итог AI» после матча убран блок «Голы:» с итогами этих рынков (в Mini App — #910) — **Claude** — [PR #911](https://github.com/TRAP44/football-analytics-cloudflare/pull/911) (вместе с главной), ветка `claude/compact-home-feed` — ревью: Codex
- [ ] Mini App, главная без лишнего (Сергей 15.10: «убрать лишнее и ненужную инфу»): карточка ленты — одна строка как в SIGNAL V2 (время/LIVE, команды, счёт), вся строка открывает матч; две звезды, «Следить» и «30 мин.» ушли внутрь матча (в ленте только метки 🔔/👁/AI); вернувшимся (есть история или закрыт «Быстрый старт») — без слогана «Читай игру» и без блока «Чем отличается»; в разборе нет строки про лимит/Pass, пока платежи выключены — **Claude** — [PR #911](https://github.com/TRAP44/football-analytics-cloudflare/pull/911), ветка `claude/compact-home-feed` — ревью: Codex
- [ ] Mini App, быстрые правки после UX-ревью: (1) топ-турниры — в раскрытой секции «Главные матчи» сразу после LIVE, а не в свёрнутом «Позже»; (2) убраны «3+ гола», «Забьют обе команды», «Забивали обе» и итоги этих рынков после матча (решение Сергея: никаких ставочных рынков); (3) исходы и оценка по ходу матча — целыми процентами, сумма ровно 100 — **Claude** — [PR #910](https://github.com/TRAP44/football-analytics-cloudflare/pull/910), ветка `claude/miniapp-quick-ux` — ревью: Codex


- [ ] Шапка и нижняя полоса Telegram в цвет фона Mini App (как у Blum) — **Claude** — [PR #904](https://github.com/TRAP44/football-analytics-cloudflare/pull/904), ветка `claude/telegram-chrome-color` — ревью: Codex

















- [ ] Бот: чистые новости (Сергей 13.10: «выглядит ужасно») — в ленте больше нет страниц-прогнозов/ставок («… Prediction, Lineups | RotoWire»), у заголовков убран хвост «| Источник»; новости любимой команды — в том же компактном виде (заголовки-ссылки, кнопка ближайшего матча, «Обновить», «Все новости») — **Claude** — ветка `claude/bot-news-clean` — ревью: Codex
- [ ] Бот: новый вид «⚽ Матчи» и «🔴 LIVE» (Сергей 13.10: «выглядит ужасно», оба списка одинаковые) — наверху главные турниры, а не случайные LIVE низших лиг; матчи сгруппированы по турнирам (с страной), у LIVE минута и счёт, у предстоящих время МСК; кнопки с минутой/временем вместо одинаковых 🔴; «главные 8 из N»; кнопка «🔄 Обновить» — **Claude** — ветка `claude/bot-matches-live` — ревью: Codex
- [ ] CI: обновление GitHub Actions вместо PR Dependabot #856 и #857 — setup-node 7.1.0, upload-artifact 7.0.2, codeql-action, download-artifact 8.0.2; тесты с закреплёнными SHA обновлены — **Claude** — ветка `claude/actions-bump` — ревью: Codex
- [ ] Бот: компактные «📰 Новости» (решение Сергея 13.10) — «Главное в футболе»: до 5 заголовков-ссылок с источником и одна кнопка «🔄 Обновить»; убраны «Почему важно», «Что проверить», кнопки «Источник N»/«Проверить с AI» и кнопки команд. Новости любимой команды — без изменений — **Claude** — ветка `claude/bot-news-compact` — ревью: Codex
- [ ] CLAUDE.md: порядок работы в каждом чате (новый чат на задачу, без подписки на PR и ожидания Codex, подсказка следующего шага, идеи по запросу) — **Claude** — ветка `claude/claude-md-session-rules` — ревью: Codex
- [ ] Канал: включены «Матчи дня» (11:00 МСК) и «Перелом матча» (главные турниры, ≤ 3 в день) — `CHANNEL_DAILY_POST_ENABLED=true`, `CHANNEL_SWING_POST_ENABLED=true` (Сергей 13.10: «да» на оба) — **Claude** — [PR #876](https://github.com/TRAP44/football-analytics-cloudflare/pull/876) — ревью: Codex
- [ ] Бот: одно меню из 6 кнопок (Матчи, LIVE, Мои команды, Новости, Тарифы, Уведомления), без «Ещё». Убраны совсем: Последний разбор, Протокол AI, AI-подборка (/last, /track, /picks), на карточке матча — Судья, Риски матча, Обновить AI; старые кнопки отвечают «меню обновлено». «Матчи»/«LIVE» больше не отвечают «не найдено» при истёкшем кэше — берут снимок провайдера из фонового запуска; «Мои команды» — прежний ответ, если провайдер недоступен — **Claude** — [PR #875](https://github.com/TRAP44/football-analytics-cloudflare/pull/875) — ревью: Codex
- [ ] Mini App: кнопка «Разобрать матч» в карточках поиска и страницы команды — на всю ширину, янтарная (скриншот Сергея 13.10: была крупной серой справа — `button { font: inherit }` перебивал 11px) — **Claude** — [PR #874](https://github.com/TRAP44/football-analytics-cloudflare/pull/874) — ревью: Codex

## Готово

- [x] Первые два официальных источника J.LEAGUE — **Codex** — [PR #1004](https://github.com/TRAP44/football-analytics-cloudflare/pull/1004), merged601a9667 после exact-head CI (Chrome startup rerun на свежем runner), mainQuality40015069828/Deploy40015491940success. ActualRefresh40015072759: published2/rejected0. Эфир24Oct08:55МСК, RU/KZ/BY; реальный phoneplayback ещё не проверен.

- [x] Ограниченное исследование источников без публикации — **Codex** — [PR #1003](https://github.com/TRAP44/football-analytics-cloudflare/pull/1003), merged44d7e581 после Quality40012184807/CodeQL40012184799/audit40012184839success. Actual40012750842 нашёл2предстоящих J.LEAGUEvideo дляRU, SPL повтор40012892597 вернул0. Researchнеавтоодобрение.

- [x] Проверка первого кандидата SPL — **Codex** — [PR #1002](https://github.com/TRAP44/football-analytics-cloudflare/pull/1002), mergedb552ac78 после всех4CI, Deploy40010952883success; actual source40010422802: официальный канал и fixture1603475 подтверждены, но0LIVE/0upcoming, поэтому ничего не опубликовано. Общая задача просмотра остаётся открытой.

- [x] «Где смотреть»: каталог, страна, официальный player/fallback и кнопка бота — **Codex** — [PR #1001](https://github.com/TRAP44/football-analytics-cloudflare/pull/1001), mergedb63a83d7; exact-head Quality39993170768/CodeQL39993170719 success, full4601. MainQuality40005795194/Deploy40006332394 success; public launch138 подтверждён. Manifest пуст до проверки реального источника; #943/#948 не закрыты.

- [x] «Где смотреть»: ключ и официальные YouTube-метаданные — **Codex** — [PR #1000](https://github.com/TRAP44/football-analytics-cloudflare/pull/1000), merged2f2ca3bd; actual39956319359success: key/channel confirmed,0LIVE/5архивныхпремьер, свежийfixturecacheempty. MainCI/Deploy39956816087success, runtimeartifactнеизменён (launch137). Это sourceproof, неготовностьпросмотра.

- [x] Профиль и избранное игрока вне LIVE — **Codex** — [PR #999](https://github.com/TRAP44/football-analytics-cloudflare/pull/999), опубликован source685df4e0/version33d02c1d, launch137; Deploy39943033492/Monitor39943417769 и25public checks success.

- [x] Разговорный AI до матча и LIVE, включая #995–#998 — **Codex** — [PR #998](https://github.com/TRAP44/football-analytics-cloudflare/pull/998); два actual runs39747728056/39747830998 success, Deploy39748224394 sourcead2a2541/version668e7642, launch136; public manifest и monitor39918182428 подтверждены23октября.

- [x] Собственный вопрос о голах: гарантированно использовать доступную голевую модель — **Codex** — [PR #994](https://github.com/TRAP44/football-analytics-cloudflare/pull/994), `codex/match-goals-question`, продолжение #993/#976. Реальный AI probe прошёл форму/H2H/атаку, но не общий вопрос о голах; direct lookup без inference и квот, прежние guards, контролируемое отсутствие оценки. Выпущено: main25c94ef0, Deploy39647772080/Monitor39648239141/realAI39647171341 success; proof #976 issuecomment-6325715383.
- [x] Матч: рабочее напоминание за 15 минут, свои вопросы без готовых подсказок и лишней сводки перепроверки — **Codex** — [PR #993](https://github.com/TRAP44/football-analytics-cloudflare/pull/993), `codex/match-reminder-chat-cleanup`. Исправить SQL ISO-даты и восстановление кнопки после ошибки загрузки; расширить факты своих вопросов, сохранить скорость и серверные проверки. Выпущено: main25c94ef0, Deploy39647772080/Monitor39648239141/realAI39647171341 success; proof #976 issuecomment-6325715383.

- [x] Потерянные ответы Supabase и атомарная миграция v18 — **Codex** — [PR #992](https://github.com/TRAP44/football-analytics-cloudflare/pull/992), опубликован e86016a6, migration/apply + encrypted backup/restore + 25 HTTP/browser checks; 3 реальных фоновых запуска с 9 LIVE-циклами успешны. Подтверждение: #976 issuecomment-6319836567. Внешние сетевые сбои не объявляются устранёнными.


- [x] Доверенный официальный CA Supabase в protected preflight — **Codex** — [#991](https://github.com/TRAP44/football-analytics-cloudflare/pull/991), merge0bdb3fb2. Production preflight39576130658 успешен: verify-full, service_role, actual base af06. Backup39576135267 dump + isolated restore success. API apply39576716499 получил403; дальше используется существующее admin PG connection, миграция ещё не применена.

- [x] Чтение schema/security contracts выпуска через existing backup connection — **Codex** — [#990](https://github.com/TRAP44/football-analytics-cloudflare/pull/990), merge87e4b1b7. PR checks pass; production preflight39574757744 остановился на проверке TLS до SQL, исправляется trust store. Backup39574752929 проходит отдельно; production migration не применялась.

- [x] Реализация безопасного восстановления durable Supabase writes — **Codex** — [#989](https://github.com/TRAP44/football-analytics-cloudflare/pull/989), merge583d77cd. Все PR checks pass (Quality39571682383, CodeQL39571682555, Load39571682524). Backup39572462589 dump + isolated restore pass. Общий этап не завершён: preflight400 до любых DB changes, исправляется проверка выпуска.

- [x] Отклонять пустую Telegram-авторизацию до лишнего RPC — **Codex** — [#988](https://github.com/TRAP44/football-analytics-cloudflare/pull/988), merge84f3243f. Deploy39503734848/Monitor39504104530 success; Worker be8b44a6 на 100%, 25 HTTP и rendered smoke. Actual39503598097: основные задачи + 3 LIVE завершены, 4 чтения восстановлены. Таймаут cache write остался и входит в текущую задачу.

- [x] Восстановление зависших SELECT внутри исходного бюджета — **Codex** — [#987](https://github.com/TRAP44/football-analytics-cloudflare/pull/987). Выпущен ea7e6b16, Deploy39500881094/Monitor39501314502success, 25 HTTP/rendered UI checks. Actual39500937683: remindersOK/одинLIVEOK, slowFallbacks4/backupWins2/originalWins2/failedAfterFallback0. Run остаётся failed: последующий claim RPC7s, затем overlap; не считать RPC-проблему исправленной. Первый deploy39500401378 откатился после неуспешного missing-auth smoke; повтор прошёл без ослабления проверок.

- [x] Убрать восемь пустых PATCH очистки заявок уведомлений — **Codex** — [#986](https://github.com/TRAP44/football-analytics-cloudflare/pull/986), `codex/reminder-stale-preflight`. Один ограниченный existenceGET, при кандидате все старые conditionalwrites. No retry/dedup/lease изменения; sourceпроверка и independent review без блокеров. Выпущен c573fc9f: Deploy39453238278/Monitor39453959538success, actual39454368499 remindersOK+3LIVEOK. Rootтаймауты остаются открыты.

- [x] Supabase: получить серверные агрегаты SQL, журналов и ресурсов без пользовательских данных — **Codex** — [#985](https://github.com/TRAP44/football-analytics-cloudflare/pull/985), `codex/supabase-server-evidence`. Только фиксированные read-only запросы, main-only protected workflow; billing не требуется. Общая задача таймаутов остаётся открытой. #985 merged ed9b8290; оба actual diagnostics runs success; private/raw data не возвращались. Диагностика завершена, root timeout остаётся открытым.

- [x] Восстановление фона после таймаута настроек и продолжение LIVE после безопасно завершённого основного цикла — **Codex** — [#984](https://github.com/TRAP44/football-analytics-cloudflare/pull/984), `codex/background-control-read-recovery`, продолжение #976/#983; root Supabase timeout не объявлен устранённым. Выпуск: main c709cbac; Deploy39438395894/Monitor39438777960 success; actual39438347309 подтвердил независимые LIVE.

- [x] Устойчивость REST фона: отмена GET, резерв lease, ограничение параллелизма — **Codex** — [#983](https://github.com/TRAP44/football-analytics-cloudflare/pull/983), merge06a2de6d, deploy39400145889/monitor39400501551success. Последующие realruns всё ещё содержат Supabase timeouts; общая задача продолжается.

- [x] Измерение этапов существующих фоновых запросов Supabase без дополнительных обращений — **Codex** — [#982](https://github.com/TRAP44/football-analytics-cloudflare/pull/982), `codex/supabase-transport-diagnosis`. Первичный timeout этим шагом не устранён.

- [x] Агрегированный недельный отчёт: люди, возвраты и использование разборов на реальных данных — **Codex** — [#981](https://github.com/TRAP44/football-analytics-cloudflare/pull/981), `codex/weekly-product-observations`, этап 5 #976. — actual run39393393320:4аккаунта/3повторных/6выдачAI.

- [x] Первый запуск и кнопки бота: убрать молчаливые тупики и ожидание настройки меню перед выбором команды — **Codex** — [#980](https://github.com/TRAP44/football-analytics-cloudflare/pull/980), `codex/bot-first-run-completion`, этап 4 #976. — опубликован, production monitor прошёл.

- [x] Уведомления: следующий минутный LIVE-слот после отказа lease до начала работы — **Codex** — [#979](https://github.com/TRAP44/football-analytics-cloudflare/pull/979), `codex/live-window-lease-recovery`, этап 3 плана #976. — слит, реальный фоновый запуск прошёл все 4 LIVE-слота.

- [x] AI-чат: доступные вероятности всех исходов и стартовые составы в ответах — **Codex** — [#978](https://github.com/TRAP44/football-analytics-cloudflare/pull/978), `codex/complete-match-question-facts`, этап 2 плана #976.

- [x] Скорость: ранняя проверка совместимости и открытие готового матча без ожидания необязательной записи кеша — **Codex** — [#977](https://github.com/TRAP44/football-analytics-cloudflare/pull/977), `codex/startup-critical-path`, план #976, этап 1.

- [x] Быстрые ответы на вручную введённые готовые вопросы — **Codex** — [#975](https://github.com/TRAP44/football-analytics-cloudflare/pull/975), `codex/typed-match-question-fast-path`.

- [x] Проверка фактических LIVE-резюме по общему публичному кешу матчей — **Codex** — [#974](https://github.com/TRAP44/football-analytics-cloudflare/pull/974), `codex/live-summary-observation`.

- [x] Связное обновляемое резюме картины матча из нескольких подтверждённых факторов — **Codex** — [#973](https://github.com/TRAP44/football-analytics-cloudflare/pull/973), `codex/live-match-summary`. — слит и опубликован.

- [x] Чистая AI-карточка картины матча: без процентов покрытия и пустой плашки — **Codex** — [#972](https://github.com/TRAP44/football-analytics-cloudflare/pull/972), `codex/clean-match-insight-card`. — слит и опубликован.

- [x] Первый вход: ранняя загрузка стартового JS; чат: фактические игроки стартового состава — **Codex** — [#971](https://github.com/TRAP44/football-analytics-cloudflare/pull/971), `codex/startup-and-lineup-answers`. — слит и опубликован.

- [x] Заменить подтверждённый HTTP200 PNG-заполнитель FARDU по exact SHA256 — **Codex** — [#970](https://github.com/TRAP44/football-analytics-cloudflare/pull/970), `codex/verified-provider-placeholder`. — слит и опубликован.

- [x] Ускорить первый вход и заменить отсутствующие гербы; проверить конкретный PNG-заполнитель FARDU — **Codex** — [#969](https://github.com/TRAP44/football-analytics-cloudflare/pull/969), `codex/startup-and-crest-fallback`. — слит1fbfe2fb, ускорениеготово; actualFARDUplaceholderполучен39240543606.

- [x] Подтверждение ownership после таймаута renew и разбор fallback кеша — **Codex** — [#968](https://github.com/TRAP44/football-analytics-cloudflare/pull/968), `codex/lease-renewal-reconcile`. — опубликованabca7442; natural39234302505 normal+3LIVEOK.

- [x] Диагностировать остановку Cloudflare→GitHub dispatch: безопасная причина/HTTP, различение rate limit и auth — **Codex** — [#967](https://github.com/TRAP44/football-analytics-cloudflare/pull/967), `codex/background-dispatch-diagnosis`. — опубликованa10ff756; HTTP422, natural09:40/09:45UTC восстановлен; отдельныйrenewсбой остаётся.

- [x] Досверить незакрытые прогнозы по стабильномуfixtureID, включая переносы/устаревшие даты — **Codex** — [#966](https://github.com/TRAP44/football-analytics-cloudflare/pull/966), `codex/pending-fixture-identity`. — опубликован04d0f64a; источник13IDнефинален, предыдущие26закрыты.

- [x] Разовая сверка40pending с официальным источником без включения автоматического восстановления — **Codex** — `codex/manual-pending-recovery`. — [PR #963](https://github.com/TRAP44/football-analytics-cloudflare/pull/963). — опубликован;26закрыто,13проверенныхосталось.

- [x] Надёжное подтверждение завершения cron после таймаута и сверка причин старых pending — **Codex** — `codex/scheduled-completion-reconcile`. — [PR #962](https://github.com/TRAP44/football-analytics-cloudflare/pull/962). — опубликован.

- [x] Мгновенный контекст матча, повторное открытие без ожидания и защита поздних ответов — **Codex** — `codex/instant-match-opening`. — [PR #961](https://github.com/TRAP44/football-analytics-cloudflare/pull/961). — опубликован.

- [x] Ускорить критический путь свежего AI-разбора: независимые обогащения параллельно, без потери данных/квоты — **Codex** — `codex/analysis-critical-path`. — [PR #960](https://github.com/TRAP44/football-analytics-cloudflare/pull/960). — опубликован.

- [x] Быстрые LIVE-уведомления между пятиминутными запусками и свежие наблюдения — **Codex** — `codex/live-notification-fast-window`. — [PR #959](https://github.com/TRAP44/football-analytics-cloudflare/pull/959). — опубликован, три естественных minute ticks OK.

- [x] Личные уведомления: избранные команды + наблюдение, все карточки, короткие события и согласованный итог — **Codex** — `codex/personal-match-notifications`. — [PR #958](https://github.com/TRAP44/football-analytics-cloudflare/pull/958). — опубликован, deploy39149377760/external39149568393 прошли.

- [x] «Обыграй AI»: закрытие по актуальному началу/статусу, отказ при недоступном источнике — **Codex** — `codex/match-pick-live-cutoff`. — [PR #957](https://github.com/TRAP44/football-analytics-cloudflare/pull/957). — опубликован; deploy39143978391/external39144221524 прошли.

- [x] Подписки: исходная цена продления после повторной смены тарифов — **Codex** — `codex/subscription-renewal-price`. — [PR #956](https://github.com/TRAP44/football-analytics-cloudflare/pull/956). — CI прошёл, слит.

- [x] Общая оптимизация запросов приложения: бюджеты retry/body, bootstrap profile, чтение прав/квоты и защита от stale in-flight — **Codex** — [PR #955](https://github.com/TRAP44/football-analytics-cloudflare/pull/955), `codex/app-request-efficiency`. — опубликован, real AI и внешний монитор прошли.

- [x] Вопросы по фактам матча (судья, полная форма и потери), осмысленные подсказки и быстрый показ ленты при входе — **Codex** — [PR #954](https://github.com/TRAP44/football-analytics-cloudflare/pull/954), `codex/match-chat-grounded-startup`. — слит/опубликован; расширенный real AI probe39115942261 успешен.

- [x] Вернуть подтверждённую настоящим binding быструю модель; перепроверить полный текстовый вопрос и публикацию — **Codex** — [PR #953](https://github.com/TRAP44/football-analytics-cloudflare/pull/953), `codex/match-chat-verified-model`. — слит и опубликован; real service probe39114320518 успешен.

- [x] Исправить запуск реальной проверки AI: убрать отключающий remote bindings флаг Wrangler; повторить service verification — **Codex** — [PR #952](https://github.com/TRAP44/football-analytics-cloudflare/pull/952), `codex/match-chat-remote-binding`. — слит; remote вызов включён и реально выполнен.

- [x] Текстовые вопросы по матчу: проверить и исправить полный серверный путь Workers AI; ускорить ответы Telegram-бота без потери проверок — **Codex** — [PR #951](https://github.com/TRAP44/football-analytics-cloudflare/pull/951), `codex/match-chat-service`; локально 4289/4289, browser и независимое ревью прошли; real remote AI check после merge. — слит; первый probe отключил remote AI флагом --local, проверка ещё не подтверждена.

- [x] Исправить готовые вопросы AI без ложного требования истории; ускорить матч-центр и AI ограниченным параллелизмом, без дополнительных запросов — **Codex** — [PR #950](https://github.com/TRAP44/football-analytics-cloudflare/pull/950), `codex/match-center-parallel-data`; локально4274/4274, browser/независимое ревью прошли, CI, merge и production deploy прошли.

- [x] Открытие AI без отдельного запроса доступа и рабочее действие «Спросить про матч» — **Codex** — [PR #942](https://github.com/TRAP44/football-analytics-cloudflare/pull/942), `codex/analysis-ui-requests`; 4267/4267 и браузерные клики/ответы проверены, независимое ревью без блокеров. — слит и опубликован.

- [x] Ускорение AI: ограничить ожидание необязательного веб-поиска и перекрыть независимые чтения кеша — **Codex** — [PR #941](https://github.com/TRAP44/football-analytics-cloudflare/pull/941), `codex/analysis-response-speed`; 4263/4263, независимое ревью без блокеров; CI и применение по разрешению Сергея. — слит, production 4101c635 проверен.

- [x] Диагностика записи кеша и стадий медленного AI — **Codex** — [PR #940](https://github.com/TRAP44/football-analytics-cloudflare/pull/940), `codex/ai-latency-diagnostics`; 4256/4256, release 586/586, без сырых ошибок/идентификаторов; ревью Claude. — слит, deploy успешен.

- [x] AI: одно чтение свежего/устаревшего кеша вместо двух — **Codex** — [PR #939](https://github.com/TRAP44/football-analytics-cloudflare/pull/939), `codex/analysis-cache-snapshot`; full 4249/4249, release 585/585; ревью Claude. — слит.

- [x] Агрегированный read-only отчёт реальных AI/LIVE после приглашения людей — **Codex** — [PR #938](https://github.com/TRAP44/football-analytics-cloudflare/pull/938), ветка `codex/live-usage-report`; существующие ops_events и секреты background-jobs, без новых рассылок/нагрузки. — ревью Claude;4246тестов прошли, production report после слияния. — слит 16.10.

- [x] Удалить новости и утреннюю подборку из бота и настроек — **Codex** — [PR #937](https://github.com/TRAP44/football-analytics-cloudflare/pull/937), ветка `codex/bot-without-news`; Сергей16.10: убрать оба целиком. — замечание Claude по digest SLO исправлено; нужны CI нового head и повторное ревью. — слит, production deploy38952195397 success.

- [x] Отказ просроченного RPC даже при исключении AbortController.abort — **Codex** — [PR #936](https://github.com/TRAP44/football-analytics-cloudflare/pull/936), ветка `codex/rpc-expiry-abort` — замечание Claude к #933;4246тестов/32load-сценария прошли, ревью Claude. — слит, deploy38935145546 success.

- [x] Общий deadline RPC Supabase до конца body, без повторов неизвестных записей — **Codex** — [PR #935](https://github.com/TRAP44/football-analytics-cloudflare/pull/935), ветка `codex/rpc-body-deadline` — ревью Claude без блокеров, 7 CI зелёные — слит 16.10; Quality main прошёл, production deploy38927527491 выполняется.

- [x] Безопасный повтор продления lease фонового задания при временном сбое — **Codex** — [PR #934](https://github.com/TRAP44/football-analytics-cloudflare/pull/934), ветка `codex/scheduled-lease-timeouts` — ревью: Claude. — добавлена настоящая DB-нагрузка1000lease, гонка40claim, HTTP1000clients и soak; отчёт docs/RELEASE_LOAD_2026_10_16_RU.md — слит 16.10, production deploy38920819068 success.

- [x] Ограниченная очередь RPC лимитера с прежним общим дедлайном — **Codex** — [PR #933](https://github.com/TRAP44/football-analytics-cloudflare/pull/933), ветка `codex/rate-claim-admission` — ревью: Claude. — исправлены замечания по аренде/body/overflow, повторное ревью — слит 16.10

- [x] Пакетная проверка атрибуции перед наградой за приглашение — **Codex** — [PR #931](https://github.com/TRAP44/football-analytics-cloudflare/pull/931), ветка `codex/referral-eligibility-batching` — ревью: Claude. — слит 16.10

- [x] Пакетные свежие чтения квоты без кеша прав и без миграции — **Codex** — [PR #930](https://github.com/TRAP44/football-analytics-cloudflare/pull/930), ветка `codex/quota-read-batching` — ревью: Claude. — слит 16.10

- [x] Замер параллельного чтения квоты: прототип отклонён, результат в docs/CACHED_ANALYSIS_LATENCY_RU.md — **Codex** — [PR #929](https://github.com/TRAP44/football-analytics-cloudflare/pull/929), ветка `codex/cached-quota-overlap` — ревью: Claude. — слит 16.10

- [x] Mini App: ошибка загрузки «Мои команды» с повтором и сохранением списка — **Codex** — [PR #926](https://github.com/TRAP44/football-analytics-cloudflare/pull/926), ветка `codex/my-teams-load-recovery` — ревью: Claude. — слит.

- [x] Пакетная синхронизация профилей при массовом первом входе — **Codex** — [PR #906](https://github.com/TRAP44/football-analytics-cloudflare/pull/906), ветка `codex/analysis-user-write-batching` — ревью: Claude. — слит.

- [x] Упростить штаб матча (Сергей 15.10: «тонна странной инфы») — данные открыты сразу, 3 вкладки: Главное (что важно, голы, судья, кнопка «Обновить разбор» только когда нужно) · Составы (составы, кто не сыграет) · Форма (форма, последние матчи, место в таблице, очные встречи). Убраны «Почему модель пришла к этим процентам», «Сценарии», «Как голосуют источники», полнота данных, неопределённость, «п.п.», «Матч за 15 секунд», «Сравнение», «Модель», «Контекст»/паспорт данных — **Claude** — [PR #908](https://github.com/TRAP44/football-analytics-cloudflare/pull/908), ветка `claude/simplify-match-hq` — ревью: Codex — слит 15.10.
- [x] Не показывать пользователю название поставщика данных (Сергей 15.10): «API-Football», «Прогноз API», «API Prediction» заменены на «источник данных»/«внешний прогноз», убран противоречивый фактор «Прогноз API-Football указывает: …» — **Claude** — [PR #907](https://github.com/TRAP44/football-analytics-cloudflare/pull/907), ветка `claude/hide-provider-name` — ревью: Codex. — слит 15.10.
- [x] «Перелом матча» удалён целиком (Сергей 15.10: «вообще удали, это не нужно») — посты в канал, личные сообщения, задание в расписании, флаги `CHANNEL_SWING_POST_ENABLED`/`MATCH_SWING_ENABLED` — **Claude** — [PR #905](https://github.com/TRAP44/football-analytics-cloudflare/pull/905), ветка `claude/remove-channel-swing-posts` — ревью: Codex. — слит 15.10.
- [x] Сократить p95 готового разбора под реальной DB-нагрузкой без ослабления квот/истории — **Codex** — [PR #902](https://github.com/TRAP44/football-analytics-cloudflare/pull/902), ветка `codex/cached-analysis-latency` — ревью: Claude. — слит.
- [x] Настоящая БД под HTTP-нагрузкой: отдельный Supabase/PostgREST, 10→50→100→1000 клиентов — **Codex** — [PR #900](https://github.com/TRAP44/football-analytics-cloudflare/pull/900), ветка `codex/real-database-http-load` — ревью: Claude. — слит.

- [x] Задача 2: матчи с напоминанием первыми в фоновом предматчевом расчёте — **Claude** — [PR #899](https://github.com/TRAP44/football-analytics-cloudflare/pull/899) — слит 15.10. Задача 2 закрыта: этап «единое время расчёта в штабе/карточках» отменён решением Сергея 15.10 («пользователь не должен этого видеть»).
- [x] Канал: удалён ежедневный пост «Матчи дня» (Сергей 15.10) — **Claude** — [PR #901](https://github.com/TRAP44/football-analytics-cloudflare/pull/901) — слит 15.10.
- [x] Массовый запуск: read-only аудит инфраструктуры через существующие secrets GitHub — **Codex** — [PR #898](https://github.com/TRAP44/football-analytics-cloudflare/pull/898), ветка `codex/github-infrastructure-audit` — ревью: Claude. — слит.

- [x] Массовый запуск: объединить холодные чтения runtime_controls без задержки отключения функций — **Codex** — [PR #897](https://github.com/TRAP44/football-analytics-cloudflare/pull/897), ветка `codex/runtime-controls-singleflight` — ревью: Claude. — слит.

- [x] Массовый запуск: изолированная проверка 10 000/сутки и пика 1000 — **Codex** — [PR #896](https://github.com/TRAP44/football-analytics-cloudflare/pull/896), ветка `codex/mass-launch-capacity` — ревью: Claude. — слит.

- [x] Задача 1: сортировка ближайшего матча любимой команды — **Codex** — [PR #805](https://github.com/TRAP44/football-analytics-cloudflare/pull/805) — ревью: Claude. — слит.

- [x] Задача 2: один пересчёт по объявленному составу — **Codex** — [PR #895](https://github.com/TRAP44/football-analytics-cloudflare/pull/895), ветка `codex/prematch-lineup-refresh`. — ревью: Claude. — слит.

- [x] Задача 2: замер запросов и резерв пользователей для фоновых прогнозов — **Codex** — [PR #894](https://github.com/TRAP44/football-analytics-cloudflare/pull/894), ветка `codex/prematch-user-reserve`. — ревью: Claude. — слит.

- [x] Свежие LIVE и счёт любимых клубов из общих снимков — **Codex** — [PR #893](https://github.com/TRAP44/football-analytics-cloudflare/pull/893), ветка `codex/favorite-live-freshness` — ревью: Claude. — слит.

- [x] Аудит ответов бота: длинные названия, кнопки и пустые состояния — **Codex** — [PR #892](https://github.com/TRAP44/football-analytics-cloudflare/pull/892) — ревью: Claude. — слит.

- [x] Стабильная LIVE-картинка при изменении минуты — **Codex** — [PR #891](https://github.com/TRAP44/football-analytics-cloudflare/pull/891) — ревью: Claude. — слит.

- [x] Убрать подзаголовок «главные N из M · время МСК» из списков бота — **Codex** — [PR #890](https://github.com/TRAP44/football-analytics-cloudflare/pull/890) — ревью: Claude. — слит.

- [x] Картинки списков матчей и LIVE с настоящими логотипами — **Codex** — [PR #889](https://github.com/TRAP44/football-analytics-cloudflare/pull/889) — ревью: Claude. — слит.
- [x] Утренняя подборка: ссылки, цвета команд, одна кнопка — **Codex** — [PR #887](https://github.com/TRAP44/football-analytics-cloudflare/pull/887) — ревью: Claude. — слит.

- [x] Проверять версию smoke по константе приложения — **Codex** — [PR #886](https://github.com/TRAP44/football-analytics-cloudflare/pull/886). — слит, launch115 опубликована.
- [x] Исправить кеширование модулей в post-deploy smoke — **Codex** — [PR #885](https://github.com/TRAP44/football-analytics-cloudflare/pull/885). — слит, launch115 опубликована.
- [x] Второй этап очистки UI: девять пунктов аудита — **Codex** — [PR #884](https://github.com/TRAP44/football-analytics-cloudflare/pull/884) — ревью: Claude. — слит, launch115 опубликована.

- [x] Убрать повторы оценок и пояснений на экране матча — **Codex** — [PR #883](https://github.com/TRAP44/football-analytics-cloudflare/pull/883)

- [x] Оформление бота, вариант A (решение Сергея 13.10, аватар не трогаем): короткий /start без ставочного «пропустить матч», в «••• Ещё» — «💎 Тарифы» (цены из конфигурации) и «⚙️ Уведомления» с переходом в нужный блок профиля, подсказка в поле ввода, команды в меню «/», справка по-русски — **Claude** — [PR #872](https://github.com/TRAP44/football-analytics-cloudflare/pull/872) — слит 13.10
- [x] Бот: меньше кнопок (Сергей 13.10 — «уберём ненужные совсем»). Главное меню — 4 (⚽ Матчи, 🔴 LIVE, ⭐ Мои команды, ••• Ещё), «Ещё» — 6 (AI-подборка, Последний разбор, Новости, Протокол AI, Тарифы, Уведомления). Убраны «Найти матч» (клуб пишут в чат), «Как это работает» (/help), «← Главное меню» (/start), «Утренняя подборка» — кнопками внутри «⚙️ Уведомления». Старые подписи по-прежнему работают — **Claude** — [PR #873](https://github.com/TRAP44/football-analytics-cloudflare/pull/873) — слит 13.10
- [x] Канал: фильтр «главных турниров» (решение Сергея 13.10 — сначала фильтр, потом включение). Новый `isChannelLeague`: справочник по id (приоритет ≥ 80), по названию — только международные турниры; национальные лиги вне справочника («Premier League» Ливана, Ямайки) в канал не идут как главные. В «Матчах дня» подпись турнира со страной: «Premier League, Ливан» — **Claude** — [PR #871](https://github.com/TRAP44/football-analytics-cloudflare/pull/871) — слит 13.10
- [x] Фиксация результатов в фоновом запуске: перед защитой лимитов `settleBacktestDaily` и проверка окончательности результатов подтягивают снимок квоты и при необходимости спрашивают `/status` (`ensureProviderSnapshot`, как в #862) — **Claude** — [PR #870](https://github.com/TRAP44/football-analytics-cloudflare/pull/870) — слит 13.10
- [x] «Перелом матча» (решение Сергея 13.10): фаворит до матча потерял ≥ 25 п. п. по ходу игры, а лидером оценки стал соперник → личное сообщение (напоминание на матч — `match.swing`, любимая команда — `team.swing`, один раз на матч) и пост в канал (главные турниры, ≤ 3 в день МСК). Канал выключен (`CHANNEL_SWING_POST_ENABLED=false`) — пока предпросмотр `CHANNEL_SWING_POST_PREVIEW` в `ops_events` — **Claude** — [PR #869](https://github.com/TRAP44/football-analytics-cloudflare/pull/869) — слит 13.10
- [x] Цены ×≈2 (решение Сергея 12.10): Match Pass 75 ⭐, Day Pass 150 ⭐, 7 дней 299 ⭐, PRO 499 ⭐/30 дней, Premium 999 ⭐/30 дней — переменные в `wrangler.jsonc` — **Claude** — [PR #867](https://github.com/TRAP44/football-analytics-cloudflare/pull/867) — слит 12.10
- [x] Приглашения с наградой (решение Сергея 12.10): новый друг по ссылке после первого разбора получает +1 бонусный AI-разбор, пригласивший — тоже (≤ 10 за 30 дней); бонус тратится сверх дневного лимита и возвращается при сбое; «Пригласить друга» в Профиле; миграция v6.29.17 (`referral_rewards`) — **Claude** — [PR #868](https://github.com/TRAP44/football-analytics-cloudflare/pull/868) — слит 12.10
- [x] Карточка-картинка «AI угадал» / «Вы и AI угадали» / «Вы обыграли AI» после проверенного итога в «Обыграй AI»: PNG 1080×1080 в янтарном стиле, системное «Поделиться» с файлом или окно с картинкой (долгое нажатие — сохранить) — **Claude** (решение Сергея 12.10) — [PR #866](https://github.com/TRAP44/football-analytics-cloudflare/pull/866) — слит 12.10
- [x] Переключатель AI в админке: «AI (Workers AI)» в настройках функций — выключает объяснение через AI и свои вопросы без деплоя; миграция Supabase v6.29.15 (`runtime_controls.ai_enabled`) — **Claude** — [PR #863](https://github.com/TRAP44/football-analytics-cloudflare/pull/863) — слит 12.10
- [x] «Обыграй AI»: прогноз 1/X/2 до начала матча в Штабе (вкладка ✦ AI), 1 очко за угаданный исход, AI играет своим предматчевым прогнозом; таблица лидеров за 30 дней в Профиле (только имя из Telegram); миграция v6.29.16 (`match_picks`) — **Claude** (решение Сергея 12.10) — [PR #864](https://github.com/TRAP44/football-analytics-cloudflare/pull/864) — слит 12.10
- [x] Канал: ежедневный пост «Матчи дня по версии модели» (11:00 МСК, до 5 матчей с предматчевым прогнозом, без ставочных слов). Выключен (`CHANNEL_DAILY_POST_ENABLED=false`): пока раз в сутки пишет предпросмотр в `ops_events` — включать после одобрения текста Сергеем — **Claude** (решение Сергея 12.10) — [PR #860](https://github.com/TRAP44/football-analytics-cloudflare/pull/860) — слит 12.10
- [x] Уведомления бота о голе и удалении: строка «📊 Оценка модели сейчас (1:0, 61′): …» — только свежая точка (≤ 10 мин), уже учитывающая все голы; задача точек кривой теперь идёт до уведомлений — **Claude** (решение Сергея 12.10) — [PR #859](https://github.com/TRAP44/football-analytics-cloudflare/pull/859) — слит 12.10
- [x] Исправления по повторному ревью Codex #836 и #839: снимок NS после задержки старта остаётся «до матча»; неподтверждённый состав помечен на поле; запасные видны без стартовых составов — **Claude** — [PR #848](https://github.com/TRAP44/football-analytics-cloudflare/pull/848) — слит 12.10
- [x] Карточки на главной во время матча: вместо скрытой полоски — последняя оценка по ходу матча («Сейчас по ходу матча · 61′»); предматчевые цифры во время игры не показываются — **Claude** — [PR #858](https://github.com/TRAP44/football-analytics-cloudflare/pull/858) — слит 12.10
- [x] Фоновые задания: при истёкшем снимке квоты сами спрашивают у API-Football /status (тариф и остаток) — иначе предматчевые прогнозы и кривая по ходу матча стояли на месте — **Claude** — [PR #862](https://github.com/TRAP44/football-analytics-cloudflare/pull/862) — слит 12.10
- [x] Чистка стилей: удалены тема «Океан» и стили выбора акцента (после решения «только янтарь», #845) — **Claude** — [PR #855](https://github.com/TRAP44/football-analytics-cloudflare/pull/855) — слит 12.10
- [x] Модель по ходу матча: красные карточки (ожидаемые голы удалённой команды ×0.75, соперника ×1.9 до конца матча; события — один запрос `/fixtures?ids` на 20 матчей) — **Claude** (решение Сергея 12.10) — [PR #854](https://github.com/TRAP44/football-analytics-cloudflare/pull/854) — слит 12.10
- [x] Штаб матча во время игры: карточка «Сейчас по ходу матча» (последняя точка оценки по счёту и минуте); в полном разборе во время матча — пометка, что цифры до матча — **Claude** (решение Сергея 12.10) — [PR #853](https://github.com/TRAP44/football-analytics-cloudflare/pull/853) — слит 12.10
- [x] Предматчевые прогнозы: потолок 20 → 60 в сутки, 2 → 3 за запуск (решение Сергея 12.10: «делай все») — **Claude** — [PR #852](https://github.com/TRAP44/football-analytics-cloudflare/pull/852) — слит 12.10
- [x] Монитор прода: ложная тревога «schema_fingerprint» — сверял замороженный отпечаток v1 с ожидаемым v2; теперь проверяет `backend_schema_contract_v2` по списку совместимых отпечатков — **Claude** — [PR #851](https://github.com/TRAP44/football-analytics-cloudflare/pull/851) — слит 12.10
- [x] Задача 3 (часть 2): кривая 1/X/2 по ходу матча — оценка по счёту и минуте от предматчевого прогноза (пуассоновская модель, `src/in-play-model.js`), фоновое задание пишет точки при смене счёта или сдвиге ≥ 1 п. п. — **Claude** (решение Сергея 12.10: «да») — [PR #847](https://github.com/TRAP44/football-analytics-cloudflare/pull/847) — слит 12.10
- [x] Задача 0, срочное исправление: правка секрета в панели помечается не `secret` — деплой #845 заблокирован; принимаем любую версию без отметки CI, если её код (хеш) совпадает с версией CI из истории деплоев; при блокировке в Summary — пометки версий — **Claude** — [PR #849](https://github.com/TRAP44/football-analytics-cloudflare/pull/849) — слит 12.10; деплой прошёл по новому пути (run 2519)
- [x] Оформление: только фирменный янтарный акцент и темы «Тёмная» / «Светлая» (или как в Telegram) — выбор акцента и тема «Океан» убраны, старые сохранённые выборы сбрасываются к янтарю — **Claude** (решение Сергея 12.10) — [PR #845](https://github.com/TRAP44/football-analytics-cloudflare/pull/845) — слит 12.10
- [x] Фоновые задачи: надёжный запуск каждые 5 минут — расписание GitHub срабатывает раз в 4–7 часов, поэтому cron Cloudflare стал «часами»: каждые 5 минут воркер вызывает `workflow_dispatch` для `cron-runner.yml` (нужен секрет `GITHUB_DISPATCH_TOKEN`, делает Сергей) — **Claude** — [PR #846](https://github.com/TRAP44/football-analytics-cloudflare/pull/846) — слит 12.10; нужен секрет `GITHUB_DISPATCH_TOKEN` в Cloudflare
- [x] Задача 0: деплой после правки секрета в панели Cloudflare — гейт принимает версию «после правки секрета», если история деплоев ведёт к версии CI с тем же хешем кода; откат — на ту же версию (секреты сохраняются) — **Claude** (решение Сергея 12.10: «да») — [PR #844](https://github.com/TRAP44/football-analytics-cloudflare/pull/844) — слит 12.10
- [x] Очередь «Ждут ревью Codex» (#810–#815, #806, #817, #825) — Codex проверил 11.10; #815 → исправлено в #817, #825/#806 → #837 — **Claude**
- [x] Задача 4: экран составов — 2.5D поле в «Штабе матча» (обе команды, расстановка по сетке источника, роли для скринридера, запасные, честные пустые состояния; макета нет — дизайн Claude по решению Сергея) — **Claude** — [PR #839](https://github.com/TRAP44/football-analytics-cloudflare/pull/839) — слит 12.10
- [x] Задача 3 (часть 1): кривая 1/X/2 в Штабе матча для LIVE и завершённых — ось минут, точка «до матча», отметки голов и красных карточек, пустое состояние «Кривая появится по ходу матча»; периодические LIVE-снимки ждут рабочих фоновых задач — **Claude** (по решению Сергея) — [PR #836](https://github.com/TRAP44/football-analytics-cloudflare/pull/836) — слит 11.10
- [x] Фоновые задачи: диагностика ключей Supabase, журнал запросов, ключ как у воркера и выключение «призрачного» cron Cloudflare (`BACKGROUND_JOBS_EXECUTOR=github`) — **Claude** — [PR #840](https://github.com/TRAP44/football-analytics-cloudflare/pull/840), [#841](https://github.com/TRAP44/football-analytics-cloudflare/pull/841), [#842](https://github.com/TRAP44/football-analytics-cloudflare/pull/842) — слиты 11.10; первый полный запуск — 23:29
- [x] Фоновые задачи через GitHub Actions вместо cron Cloudflare (Workers Free) — **Claude** — [PR #838](https://github.com/TRAP44/football-analytics-cloudflare/pull/838) — слит 11.10; ключи в окружении `background-jobs`
- [x] Задача 6: «Спросить про матч» — **Claude** — [PR #835](https://github.com/TRAP44/football-analytics-cloudflare/pull/835) — слит 11.10
- [x] Ревью Codex старых PR: #825 (P1 — ограниченный Weekend Pass при сбое истории тратил использование) и #806 (P2 — ставочная метка в LIVE; уже исправлено в #819, добавлен регрессионный тест) — **Claude** — [PR #837](https://github.com/TRAP44/football-analytics-cloudflare/pull/837) — Codex 👍
- [x] Задача 7: разбор после матча — закрыты найденные пробелы (исходы словами вместо П1/П2, русский заголовок, факторы матча без предматчевого снимка в Mini App и боте, незабитый пенальти ≠ гол, вторая жёлтая = удаление, длинные названия не вылезают) — **Claude** (по решению Сергея: Claude делает, Codex проверяет) — [PR #834](https://github.com/TRAP44/football-analytics-cloudflare/pull/834) — Codex 👍
- [x] Ревью Codex #829: «Линия 1X2», «Live-коэффициенты» и «рыночный сигнал» больше не попадают в «Что было пропущено» и «Риски» (сервер + фильтр сохранённых разборов) — **Claude** — [PR #833](https://github.com/TRAP44/football-analytics-cloudflare/pull/833) (перенос #832, который слили в ветку #831, а не в `main`) — Codex 👍 на #832
- [x] Задача 2: вероятности модели на карточках главных матчей дня (фоновый расчёт через системный вход анализа) — **Claude** (взял у Codex 11.10 по решению Сергея, пока у Codex лимит) — [PR #831](https://github.com/TRAP44/football-analytics-cloudflare/pull/831) — последний раунд правок ждёт ревью Codex (лимит)
- [x] Задача 5: AI-объяснение «простыми словами» на Cloudflare Workers AI (каталог фактов на сервере, LLM только упорядочивает ID) — **Claude** (взял у Codex 11.10 по решению Сергея, пока у Codex лимит) — [PR #830](https://github.com/TRAP44/football-analytics-cloudflare/pull/830)
- [x] Без рынка, шаг 2: кнопка бота «Риски матча» вместо «Проверить рынок», причины свежести, темы новостей, метод модели, покрытие данных без «Коэффициентов» — **Claude** — [PR #829](https://github.com/TRAP44/football-analytics-cloudflare/pull/829)
- [x] Без рынка: рыночные уведомления выключены, преданализ без «Коэффициенты П1/Н/П2», «Рынок и модель расходятся», «Линия 1X2» — **Claude** — [PR #828](https://github.com/TRAP44/football-analytics-cloudflare/pull/828)
- [x] Аудит вёрстки 320–430px: круг «центра поля» на главной по счёту, «Мои команды» в меню целиком, плашка «против», выбор цвета — **Claude** — [PR #827](https://github.com/TRAP44/football-analytics-cloudflare/pull/827)
- [x] Штаб матча: счёт не вылезает за рамку блока (крупный счёт «1 : 3» был сдвинут вправо) — **Claude** — [PR #826](https://github.com/TRAP44/football-analytics-cloudflare/pull/826)
- [x] Глубокая ссылка на анализ не тратит лимит при сбое истории — **Claude** — [PR #822](https://github.com/TRAP44/football-analytics-cloudflare/pull/822)
- [x] Mini App: исходы словами вместо «П1/П2», «ТБ 2.5» (в т.ч. в сценариях преданализа) + доработки по ревью #818 — **Claude** — [PR #820](https://github.com/TRAP44/football-analytics-cloudflare/pull/820)
- [x] Перепроверка не списывает лимит, если история анализов недоступна — **Claude** — [PR #825](https://github.com/TRAP44/football-analytics-cloudflare/pull/825)
- [x] Сервер: бот без «основного сценария» без вывода; тексты преданализа, AI Timeline и фильтр без рынка, «ТБ 2.5» и П1/П2 (ревью #818–#820) — **Claude** — [PR #823](https://github.com/TRAP44/football-analytics-cloudflare/pull/823)
- [x] Честная история: сбой хранилища → 503 «история недоступна», а не пустой список — **Claude** — [PR #821](https://github.com/TRAP44/football-analytics-cloudflare/pull/821)
- [x] Бот: нейтральные «сценарии матча» вместо ставочных формулировок — **Claude** — [PR #819](https://github.com/TRAP44/football-analytics-cloudflare/pull/819)
- [x] Штаб матча без коэффициентов: убрать «Рыночные данные», «Рынок» из пульса, покрытия и «Что изменилось» — **Claude** — [PR #818](https://github.com/TRAP44/football-analytics-cloudflare/pull/818)
- [x] Ревью Codex #815: «Отзывы» после сбоя обновления помечаются как устаревшие — **Claude** — [PR #817](https://github.com/TRAP44/football-analytics-cloudflare/pull/817)
- [x] «Сценарии матча» вместо ставочного «AI-инструктора»; вкладка «Рынок» → «Модель» — **Claude** — [PR #816](https://github.com/TRAP44/football-analytics-cloudflare/pull/816)
- [x] Отзывы: уведомление админу в бот (без дублей) + раздел «Отзывы» в админке — **Claude** — [PR #815](https://github.com/TRAP44/football-analytics-cloudflare/pull/815)
- [x] Обратная связь для всех пользователей — **Claude** — [PR #814](https://github.com/TRAP44/football-analytics-cloudflare/pull/814) (слит без ревью Codex — лимит)
- [x] «Поделиться матчем»: нейтральный текст для друзей, кнопка в штабе матча — **Claude** — [PR #813](https://github.com/TRAP44/football-analytics-cloudflare/pull/813) (слит без ревью Codex — лимит)
- [x] Удалить скрытый «AI-центр» и «AI-рейтинг дня» на главной — **Claude** — [PR #812](https://github.com/TRAP44/football-analytics-cloudflare/pull/812) (слит без ревью Codex — лимит)
- [x] Главная: без повтора матча «Для вас» в ленте, подсказка поиска помещается — **Claude** — [PR #811](https://github.com/TRAP44/football-analytics-cloudflare/pull/811) (слит без ревью Codex — лимит)
- [x] Личные экраны: без ставочных меток в «Истории» и ленте, без дублей в «Профиле», «Мои команды» — **Claude** — [PR #810](https://github.com/TRAP44/football-analytics-cloudflare/pull/810) (слит без ревью Codex — лимит; см. «Ждут ревью»)
- [x] «Команда» и «Турнир»: починить вкладки, стиль SIGNAL — **Claude** — [PR #809](https://github.com/TRAP44/football-analytics-cloudflare/pull/809)
- [x] «Честность модели» (проверенный протокол AI) на вкладке AI штаба — **Claude** — [PR #808](https://github.com/TRAP44/football-analytics-cloudflare/pull/808)
- [x] «Штаб матча» в стиле SIGNAL: вкладки AI / Обзор / Игра / Составы, AI-вывод сверху — **Claude** — [PR #807](https://github.com/TRAP44/football-analytics-cloudflare/pull/807)
- [x] Нейтральные формулировки AI-сигнала + задача 5 на Workers AI — **Claude** — [PR #806](https://github.com/TRAP44/football-analytics-cloudflare/pull/806)
- [x] Янтарные логотип, аватар и экран загрузки — **Claude** — [PR #804](https://github.com/TRAP44/football-analytics-cloudflare/pull/804)
- [x] Наблюдение в штабе и список матчей на главной — **Codex** — [PR #801](https://github.com/TRAP44/football-analytics-cloudflare/pull/801)
- [x] Персональный первый вход и ближайший матч любимой команды — **Codex** — [PR #799](https://github.com/TRAP44/football-analytics-cloudflare/pull/799)
- [x] Обновить `MATCHRADAR_BRAND_SPEC_RU.md` под янтарный неон-акцент — **Codex** — `codex/brand-spec-amber` / [PR #797](https://github.com/TRAP44/football-analytics-cloudflare/pull/797)
- [x] Главная в стиле SIGNAL (янтарь) — **Claude** — [PR #803](https://github.com/TRAP44/football-analytics-cloudflare/pull/803)
- [x] Запросы к API-Football через ретранслятор Supabase — **Claude** — [PR #800](https://github.com/TRAP44/football-analytics-cloudflare/pull/800)
- [x] Настройка совместной работы Claude + Codex — **Claude** — [PR #793](https://github.com/TRAP44/football-analytics-cloudflare/pull/793)

## Идеи / найдено по пути

- [ ] Обычный Background Jobs40187426710 (25окт14:05МСК) завершился ошибкой `smart_notifications: failed`; siblingwatchsuccess, общийleasecompleted, DBtransport176/176errors0. Уведомления не объявлять полностью здоровыми по одномуwatch. Выяснить из structuredopsотчёта причину отдельно, без повторной отправки реальным людям — найдено **Codex** при #1015.

- [ ] Тестовый helper `scripts/player-profile-browser-smoke.js` передаёт в `stopChrome` объект запуска вместо `launched.chrome`; исправить cleanup отдельно. Найдено Codex при работе над просмотром; к production-профилям это не относится.

- [ ] Наблюдение этапа 5: run39392161719 за20окт02:16–08:16UTC содержит5 CACHE_DB_WRITE/timeout,18 CRON_EXECUTION_LEASE_UNAVAILABLE,2 CRON_EXECUTION_LEASE_COMPLETE_FAILED и3 failed в агрегатах smart-notification scheduler. Это сохранённые/deduplicated строки и суммы запусков, не число уникальных инцидентов/людей. Уточнить корень DB/lease failures отдельной задачей, не ослаблять дедуп и владение lease — **Codex** — план #976.



- Claude 16.10: job `runtime-load` (Isolated Load and Resilience) один раз упал на `isolated-load-check.js --full` у ветки, где менялся только скрипт замеров; локально тот же код проходит 32/32 — похоже на нестабильность по таймингу раннера. Временная ветка `claude/latency-baseline-probe` (baseline для #923) осталась — удалить её из среды Claude не дали права, можно удалить в GitHub.
- Центр матча (LIVE-штаб, `match-center-view.js`) тоже местами перегружен: блок «О данных» с временем обновления и подсказка о качестве данных о потерях («очищено перед аналитикой · исключено: N») — можно упростить отдельной задачей (найдено 15.10 при упрощении штаба).

- [x] Фиксация результатов (`settleBacktestDaily`) в фоновом запуске на GitHub Actions начинается с пустого `memory.provider`: 12.10 до 15:10 МСК её откладывала защита лимитов (`provider_quota_guard`), хотя тариф платный. Стоит перед ней вызывать `ensureProviderSnapshot`, как в предматчевых прогнозах и кривой по ходу матча (#862). → [PR #870](https://github.com/TRAP44/football-analytics-cloudflare/pull/870)
- [ ] Два предматчевых прогноза (матчи 23.09 и 2.10) до сих пор `pending` — фиксация вчерашнего дня их больше не берёт. Нужна разовая проверка или дозачистка старых `pending`.
- [x] Фоновые задачи почти не запускались с 10.10 до 12.10 08:10 UTC (диспетчер Cloudflare → GitHub Actions); с 12.10 08:10 UTC — каждые 5 минут. «Итоги дня» 10–12.10 не ушли. Проверить 13.10 в 10:00 МСК, что рассылка прошла. → 13.10 ушли: `DAILY_DIGEST_RUN_OK` в 07:01 UTC, отправлено 3 из 3 (проверил **Claude**)
- [ ] Продление подписки Telegram Stars после смены цены: в PR цен (#867) уже совершённые платежи и продления принимаются по текущей цене и по цене по умолчанию из кода (199/399/39/89/149). При следующей смене цен (не от значений по умолчанию) нужно хранить цену исходной подписки или список прежних цен — найдено **Claude** 12.10
- [ ] «Обыграй AI»: прогноз закрывается по `model_predictions.kickoff_at` (время начала на момент снимка модели). Если матч перенесли на более раннее время, прогноз можно сделать после фактического начала. Можно дополнительно сверять статус матча из ленты провайдера — найдено **Claude** 12.10
- [ ] Проверка `runtime-load` (workflow `isolated-load-resilience.yml`, запускается при изменении `supabase/migrations/**`) падает и на `main`: шаг «Bounded soak» — здоровая волна из 50 запросов получает `FOOTBALL_COOLDOWN` «Очередь запросов к API-Football переполнена» от очереди темпа запросов (`paceProviderRequest`, появилась после этого теста). Нужно подстроить тест под очередь или очередь под тест — не чинил в PR переключателя AI — найдено **Claude** 12.10
- Cron Cloudflare на Free-тарифе (10 мс CPU на запуск) не завершается с 9.10: 237 запусков висят в `scheduled_job_leases` со статусом `running`, фактически работает раз в 15 мин и обрывается. Оплата Workers Paid из РФ затруднена — план: запускать фоновые задачи из GitHub Actions (репо публичный), затем выключить cron в `wrangler.jsonc`. — **Claude**
- [x] Кеш `backtest:settled:<вчера>` не сохраняется в общий кеш при каждом запуске (`CACHE_DB_WRITE`, ~110 за двое суток). → причина — `fixture_id: null` в общем кеше, исправлено в [PR #779](https://github.com/TRAP44/football-analytics-cloudflare/pull/779); `CACHE_DB_WRITE` в `ops_events` после 11.10 14:00 UTC нет (проверил **Claude** 12.10)
- [x] Фильтр «главные турниры» (`isTopLeague`, `src/competition-integrity-runtime.js`) для лиг вне справочника пропускает любое название с «Premier League»: в предпросмотрах канала 13.10 — Ямайка (Waterhouse — Tru-Juice, «Перелом матча») и Ливан (Tripoli SC, «Матчи дня», подпись «(Premier League)» читается как АПЛ). Перед включением канала — только справочник по id и страна в подписи — найдено **Claude** 13.10 → [PR #871](https://github.com/TRAP44/football-analytics-cloudflare/pull/871)
- [ ] Задача 3 (часть 2) — периодические LIVE-снимки кривой: модель анализа не учитывает счёт и минуту матча (рынок — предматчевые `/odds`), поэтому снимки по ходу матча почти не меняются. Чтобы кривая реагировала на голы, нужна отдельная in-play модель — это новый расчёт вероятностей, нужно решение Сергея — найдено **Claude** 12.10

_Сюда оба ассистента пишут проблемы и идеи, которые заметили вне своей задачи._

- [x] Привести текущие бренд-SVG к янтарному акценту: `public/assets/brand/matchradar-mark.svg` и `matchradar-avatar.svg` используют mint `#43E6A1` — найдено **Codex** при обновлении спецификации; сделано в `claude/brand-svg-amber` (10.10), проверено 12.10: mint в ассетах нет
- [x] Логотип в верхней панели приложения тоже мятный (тот же `matchradar-mark.svg`) — найдено **Claude**; исправляется в `claude/brand-svg-amber` (знак, аватар и wordmark в янтаре)
- [x] Следующий шаг редизайна: «Штаб матча» в стиле SIGNAL (вкладки Обзор / AI / LIVE / Составы, честные пустые состояния из прототипа PR 780) — предложено **Claude**, не назначено
- [x] **Решение Сергея:** «AI-инструктор» по сути подсказчик ставок — сигналы «Обе забьют · да», «ТБ 2.5», «движение рынка», «Что проверить перед решением», блок коэффициентов. Формулировки уже нейтрализованы, но сам формат остаётся ставочным. Варианты: переосмыслить как «сценарии матча» без рыночных терминов или оставить до этапа монетизации — найдено **Claude** → Сергей: «переделай» (10.10) — [PR #816](https://github.com/TRAP44/football-analytics-cloudflare/pull/816)
- [x] `/api/history` молча отдаёт `[]`, если Supabase не прочитал `analysis_history` (`src/user-history.js`, `getHistory`): клиент не может отличить «разборов нет» от «не удалось проверить». Нужен признак `degraded` в ответе и его учёт в карточке штаба и на главной. Лимит при этом не теряется: свежий разбор из кэша отдаётся до проверки лимита (`src/analysis-runtime.js`) — найдено **Codex** в ревью #807 → [PR #821](https://github.com/TRAP44/football-analytics-cloudflare/pull/821) (503 вместо пустого списка) и [PR #822](https://github.com/TRAP44/football-analytics-cloudflare/pull/822)
- [x] Мёртвый код: «AI-центр» на главной (`renderAiCenterSummary`, `#aiCenterSummary`, `#aiFocus`) скрыт CSS-ом (`.secondary-home-insight { display:none !important }`), но всё ещё считается и содержит ставочные формулировки («Лучше пропустить», «сигналов»). Удалить или переписать — найдено **Claude**, не назначено → удалено в [PR #812](https://github.com/TRAP44/football-analytics-cloudflare/pull/812)
- [x] Бот: вердикт «⛔ Лучше пропустить» (`src/telegram-bot-ui-runtime.js`, около строки 1128) — ставочная формулировка, в Mini App уже нейтрально («Без уверенного вывода»). Привести бота к тому же при работе над ботом — найдено **Claude** → [PR #819](https://github.com/TRAP44/football-analytics-cloudflare/pull/819)
- [x] Отзывы пользователей нигде не видны Сергею: `/api/beta-feedback` пишет их только в `ops_events`, админка показывает лишь агрегаты беты. Нужен раздел «Отзывы» в админке и/или уведомление админу в бот (с защитой от дублей) — найдено **Claude**, следующий шаг после «Обратной связи для всех» → [PR #815](https://github.com/TRAP44/football-analytics-cloudflare/pull/815)
- [x] **Решение Сергея:** уведомления «AI-сигналы» рассылают рыночные сообщения `market.movement` («Расчётная рыночная вероятность…», `src/important-change-notification-service.js`). Описание категории в настройках честное, поэтому не менялось. Убирать ли сами рыночные уведомления — найдено **Claude**, ждёт решения → Сергей: «убирай оба» (11.10) — [PR #828](https://github.com/TRAP44/football-analytics-cloudflare/pull/828)
- [x] **Решение Сергея:** в преданализе Mini App остаются драйверы и подсказки про рынок как входной сигнал модели («Рынок и модель расходятся», «Линия 1X2 отсутствует…», вес «рынок» в модели). Это прозрачность расчёта, а не ставочная подсказка, но слово «рынок» видно пользователю. Оставить как есть или убрать из интерфейса — найдено **Claude**, ждёт решения → Сергей: «убирай оба» (11.10) — [PR #828](https://github.com/TRAP44/football-analytics-cloudflare/pull/828)
- [x] Ещё упоминания рынка, которые видит пользователь (вне задачи «убрать оба», не трогал): кнопка бота «💹 Проверить рынок» и действие «рынок» в news-impact (`src/news-impact-recovery-runtime.js`), причина свежести «рынок и вероятности могли заметно измениться» (`src/analysis-lifecycle-runtime.js`), темы новостей «… · рынок» (`src/football-news-runtime.js`), метод модели «Рынок, прогноз источника…» (`src/analysis-runtime.js`), ярлыки качества коэффициентов (`src/odds-quality.js`), заметки «Сверить движение коэффициентов…» (`src/analysis-context-runtime.js`; в Mini App уже отфильтрованы). Следующий кандидат на нейтрализацию — найдено **Claude** → Сергей: «убирай» (11.10) — [PR #829](https://github.com/TRAP44/football-analytics-cloudflare/pull/829)
- [ ] Отдельный выключатель AI-объяснения в runtime controls (сейчас — переменная `AI_EXPLANATION_ENABLED` и общий `analysisEnabled`): нужна колонка в `runtime_controls` + миграция Supabase + админка — найдено **Claude** при задаче 5

## Отложено Codex

- Клубные custom emoji — [PR #888](https://github.com/TRAP44/football-analytics-cloudflare/pull/888) закрыт без merge: у владельца нет Premium/набора; выбран подход с картинками #889.
