# Доска задач MatchRadar

Общая доска для Сергея, Claude и Codex. Обновляется в каждом PR.

Формат строки: `- [ ] Задача — **исполнитель** — ветка/PR — заметка`

Исполнитель: **Claude**, **Codex** или **Сергей**. Если исполнитель не указан — задачу может взять любой, но сначала впиши себя.

## Бэклог (Сергей расставляет приоритет сверху вниз)

- [ ] Задача 2, последующие этапы после резерва: наблюдаемые команды в приоритете; один пересчёт по объявленному составу без изменения первого прогноза; единое время расчёта в штабе/допустимых карточках — **Codex**.

## В работе

_пусто_

## На ревью

- [ ] Задача 2: замер запросов и резерв пользователей для фоновых прогнозов — **Codex** — [PR #894](https://github.com/TRAP44/football-analytics-cloudflare/pull/894), ветка `codex/prematch-user-reserve`. — ревью: Claude.












- [ ] Бот: чистые новости (Сергей 13.10: «выглядит ужасно») — в ленте больше нет страниц-прогнозов/ставок («… Prediction, Lineups | RotoWire»), у заголовков убран хвост «| Источник»; новости любимой команды — в том же компактном виде (заголовки-ссылки, кнопка ближайшего матча, «Обновить», «Все новости») — **Claude** — ветка `claude/bot-news-clean` — ревью: Codex
- [ ] Бот: новый вид «⚽ Матчи» и «🔴 LIVE» (Сергей 13.10: «выглядит ужасно», оба списка одинаковые) — наверху главные турниры, а не случайные LIVE низших лиг; матчи сгруппированы по турнирам (с страной), у LIVE минута и счёт, у предстоящих время МСК; кнопки с минутой/временем вместо одинаковых 🔴; «главные 8 из N»; кнопка «🔄 Обновить» — **Claude** — ветка `claude/bot-matches-live` — ревью: Codex
- [ ] CI: обновление GitHub Actions вместо PR Dependabot #856 и #857 — setup-node 7.1.0, upload-artifact 7.0.2, codeql-action, download-artifact 8.0.2; тесты с закреплёнными SHA обновлены — **Claude** — ветка `claude/actions-bump` — ревью: Codex
- [ ] Бот: компактные «📰 Новости» (решение Сергея 13.10) — «Главное в футболе»: до 5 заголовков-ссылок с источником и одна кнопка «🔄 Обновить»; убраны «Почему важно», «Что проверить», кнопки «Источник N»/«Проверить с AI» и кнопки команд. Новости любимой команды — без изменений — **Claude** — ветка `claude/bot-news-compact` — ревью: Codex
- [ ] CLAUDE.md: порядок работы в каждом чате (новый чат на задачу, без подписки на PR и ожидания Codex, подсказка следующего шага, идеи по запросу) — **Claude** — ветка `claude/claude-md-session-rules` — ревью: Codex
- [ ] Канал: включены «Матчи дня» (11:00 МСК) и «Перелом матча» (главные турниры, ≤ 3 в день) — `CHANNEL_DAILY_POST_ENABLED=true`, `CHANNEL_SWING_POST_ENABLED=true` (Сергей 13.10: «да» на оба) — **Claude** — [PR #876](https://github.com/TRAP44/football-analytics-cloudflare/pull/876) — ревью: Codex
- [ ] Бот: одно меню из 6 кнопок (Матчи, LIVE, Мои команды, Новости, Тарифы, Уведомления), без «Ещё». Убраны совсем: Последний разбор, Протокол AI, AI-подборка (/last, /track, /picks), на карточке матча — Судья, Риски матча, Обновить AI; старые кнопки отвечают «меню обновлено». «Матчи»/«LIVE» больше не отвечают «не найдено» при истёкшем кэше — берут снимок провайдера из фонового запуска; «Мои команды» — прежний ответ, если провайдер недоступен — **Claude** — [PR #875](https://github.com/TRAP44/football-analytics-cloudflare/pull/875) — ревью: Codex
- [ ] Mini App: кнопка «Разобрать матч» в карточках поиска и страницы команды — на всю ширину, янтарная (скриншот Сергея 13.10: была крупной серой справа — `button { font: inherit }` перебивал 11px) — **Claude** — [PR #874](https://github.com/TRAP44/football-analytics-cloudflare/pull/874) — ревью: Codex
- [ ] Задача 1: сортировка ближайшего матча любимой команды — **Codex** — [PR #805](https://github.com/TRAP44/football-analytics-cloudflare/pull/805) — ревью: Claude.

## Готово

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
