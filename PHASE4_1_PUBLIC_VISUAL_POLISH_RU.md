# Phase 4.1 — Public Visual Simplification & Polish

Цель: упростить public Mini App перед продолжением Phase 5 real-user validation.

Baseline: `88ab7f56399052e7d15d90a403788b0570097dd0`.

## Границы этапа

- backend/business logic, Telegram initData, public access и admin authorization не меняются;
- API contracts, Supabase schema, provider routing/quota/cache, AI model и monetization не меняются;
- Phase 6 не начинается;
- изменения ограничены public presentation hierarchy, CSS и privacy-safe validation boundary.

## Public UX

Startup показывает только:

- FM AI;
- «Ваш футбол — в одном месте»;
- «Загружаем матчи…»;
- минимальный индикатор загрузки.

Home: поиск → LIVE только при реальном live → Мои команды или favorite onboarding → дата/матчи. Счётчики и фильтры не занимают первый уровень.

Карточка матча: турнир/время или LIVE, команды, счёт, один основной CTA. Favorites и reminder остаются вторичными действиями.

AI Match Center: матч и вероятности остаются первым уровнем; confidence/data quality, максимум три фактора и риски идут сразу после. Подробные данные доступны ниже через раскрываемый блок.

Profile: пользователь/тариф → Мои команды → напоминания → настройки. Legal/status/feedback/version находятся в нижнем блоке «О сервисе». Admin остаётся отдельной gated зоной.

## Phase 5 evidence pause/resume

Во время Phase 4.1 предыдущий `phase5_public_v1` считается pre-polish исторической выборкой и не используется для нового product-readiness решения.

После production deployment Phase 4.1 начинается чистое окно `phase5_public_v2`. Клиент получает новый session-storage namespace, поэтому старые session tokens не продолжают новый validation window.

События `phase5_public_v1` не конвертируются в `phase5_public_v2`.

## Release

Обязательный путь: tests → security → release verification → PR → merge → production deploy → post-deploy smoke.

После deployment Phase 5 продолжается; Phase 6 не начинается.
