# Доска задач MatchRadar

Общая доска для Сергея, Claude и Codex. Обновляется в каждом PR.

Формат строки: `- [ ] Задача — **исполнитель** — ветка/PR — заметка`

Исполнитель: **Claude**, **Codex** или **Сергей**. Если исполнитель не указан — задачу может взять любой, но сначала впиши себя.

## Бэклог (Сергей расставляет приоритет сверху вниз)

## В работе

_пусто_

## На ревью

- [ ] Повторы при отказах API-Football без заголовков лимита (общий адрес Cloudflare Workers) — **Claude** — `fix/edge-rejection-retries` / [PR #798](https://github.com/TRAP44/football-analytics-cloudflare/pull/798) — ревью: Codex (ветка создана до введения префикса `claude/`)
- [ ] Обновить `MATCHRADAR_BRAND_SPEC_RU.md` под янтарный неон-акцент — **Codex** — `codex/brand-spec-amber` / [PR #797](https://github.com/TRAP44/football-analytics-cloudflare/pull/797) — ревью: Claude
- [ ] Настройка совместной работы Claude + Codex (`AGENTS.md`, `CLAUDE.md`, `docs/ai-team/`) — **Claude** — `claude/ai-team-setup` — ревью: Codex

## Готово

_пусто_

## Идеи / найдено по пути

_Сюда оба ассистента пишут проблемы и идеи, которые заметили вне своей задачи._

- [ ] Привести текущие бренд-SVG к янтарному акценту: `public/assets/brand/matchradar-mark.svg` и `matchradar-avatar.svg` используют mint `#43E6A1` — найдено **Codex** при обновлении спецификации; отдельная задача на ассеты
- [ ] Источник матчей отклоняет запросы Workers: поддержка API-Football подтвердила ограничение по общему исходящему IP. Нужен выделенный исходящий адрес (ретранслятор на отдельном сервере/VPS) — **ждёт решения Сергея**; найдено **Claude**
