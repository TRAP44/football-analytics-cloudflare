# Доска задач MatchRadar

Общая доска для Сергея, Claude и Codex. Обновляется в каждом PR.

Формат строки: `- [ ] Задача — **исполнитель** — ветка/PR — заметка`

Исполнитель: **Claude**, **Codex** или **Сергей**. Если исполнитель не указан — задачу может взять любой, но сначала впиши себя.

## Бэклог (Сергей расставляет приоритет сверху вниз)

- [ ] Задача 0: деплой после правок секретов в панели Cloudflare (правка гейта, нужно явное «да» Сергея) — **Claude** — см. `TASKS_RU.md`
- [ ] Задача 2: вероятности на карточках для всех главных матчей дня — **Codex** — см. `TASKS_RU.md`
- [ ] Задача 3: кривая вероятности по ходу матча — **Codex** — см. `TASKS_RU.md`
- [ ] Задача 4: экран составов (макет E, 2.5D на CSS) — **Codex** — см. `TASKS_RU.md`
- [ ] Задача 5: AI-объяснение на Cloudflare Workers AI (бесплатно, без ключа и без задачи 0) — **Codex** — см. `TASKS_RU.md`
- [ ] Задача 6: вопросы по матчу — **Codex** — после задачи 5 — см. `TASKS_RU.md`
- [ ] Задача 7: разбор после матча — базовый блок уже есть, найти и закрыть пробелы — **Codex** — см. `TASKS_RU.md`

## В работе

_пусто_

## На ревью

- [ ] «Честность модели» (проверенный протокол AI) на вкладке AI штаба — **Claude** — `claude/ai-track-record-hq` — ревью: Codex
- [ ] Задача 1: сортировка ближайшего матча любимой команды — **Codex** — [PR #805](https://github.com/TRAP44/football-analytics-cloudflare/pull/805) — ревью: Claude.

## Готово

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

_Сюда оба ассистента пишут проблемы и идеи, которые заметили вне своей задачи._

- [ ] Привести текущие бренд-SVG к янтарному акценту: `public/assets/brand/matchradar-mark.svg` и `matchradar-avatar.svg` используют mint `#43E6A1` — найдено **Codex** при обновлении спецификации; отдельная задача на ассеты
- [x] Логотип в верхней панели приложения тоже мятный (тот же `matchradar-mark.svg`) — найдено **Claude**; исправляется в `claude/brand-svg-amber` (знак, аватар и wordmark в янтаре)
- [x] Следующий шаг редизайна: «Штаб матча» в стиле SIGNAL (вкладки Обзор / AI / LIVE / Составы, честные пустые состояния из прототипа PR 780) — предложено **Claude**, не назначено
- [ ] **Решение Сергея:** «AI-инструктор» по сути подсказчик ставок — сигналы «Обе забьют · да», «ТБ 2.5», «движение рынка», «Что проверить перед решением», блок коэффициентов. Формулировки уже нейтрализованы, но сам формат остаётся ставочным. Варианты: переосмыслить как «сценарии матча» без рыночных терминов или оставить до этапа монетизации — найдено **Claude**
- [ ] `/api/history` молча отдаёт `[]`, если Supabase не прочитал `analysis_history` (`src/user-history.js`, `getHistory`): клиент не может отличить «разборов нет» от «не удалось проверить». Нужен признак `degraded` в ответе и его учёт в карточке штаба и на главной. Лимит при этом не теряется: свежий разбор из кэша отдаётся до проверки лимита (`src/analysis-runtime.js`) — найдено **Codex** в ревью #807, не назначено
