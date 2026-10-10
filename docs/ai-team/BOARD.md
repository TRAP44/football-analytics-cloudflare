# Доска задач MatchRadar

Общая доска для Сергея, Claude и Codex. Обновляется в каждом PR.

Формат строки: `- [ ] Задача — **исполнитель** — ветка/PR — заметка`

Исполнитель: **Claude**, **Codex** или **Сергей**. Если исполнитель не указан — задачу может взять любой, но сначала впиши себя.

## Бэклог (Сергей расставляет приоритет сверху вниз)

## В работе

- [ ] Задача 1: сортировка ближайшего матча любимой команды — **Codex** — `codex/nearest-favorite-order`.

## На ревью

- [ ] Запросы к API-Football через ретранслятор Supabase (`API_FOOTBALL_BASE_URL`) — **Claude** — `claude/football-relay-base-url` — ревью: Codex
- [ ] Главная в стиле SIGNAL (вариант 3, янтарь): шапка «Читай игру», «Главный матч», компактная лента — **Claude** — `claude/home-signal-amber` / [PR #803](https://github.com/TRAP44/football-analytics-cloudflare/pull/803) — ревью: Codex

## Готово

- [x] Наблюдение в штабе и список матчей на главной — **Codex** — [PR #801](https://github.com/TRAP44/football-analytics-cloudflare/pull/801)
- [x] Персональный первый вход и ближайший матч любимой команды — **Codex** — [PR #799](https://github.com/TRAP44/football-analytics-cloudflare/pull/799)
- [x] Обновить `MATCHRADAR_BRAND_SPEC_RU.md` под янтарный неон-акцент — **Codex** — `codex/brand-spec-amber` / [PR #797](https://github.com/TRAP44/football-analytics-cloudflare/pull/797)

- [x] Настройка совместной работы Claude + Codex — **Claude** — [PR #793](https://github.com/TRAP44/football-analytics-cloudflare/pull/793)

## Идеи / найдено по пути

_Сюда оба ассистента пишут проблемы и идеи, которые заметили вне своей задачи._

- [ ] Привести текущие бренд-SVG к янтарному акценту: `public/assets/brand/matchradar-mark.svg` и `matchradar-avatar.svg` используют mint `#43E6A1` — найдено **Codex** при обновлении спецификации; отдельная задача на ассеты
- [ ] Логотип в верхней панели приложения тоже мятный (тот же `matchradar-mark.svg`) — заметно рядом с новой янтарной главной; подтверждает задачу на SVG выше — найдено **Claude**
- [ ] Следующий шаг редизайна: «Штаб матча» в стиле SIGNAL (вкладки Обзор / AI / LIVE / Составы, честные пустые состояния из прототипа PR 780) — предложено **Claude**, не назначено
