# RC58 — One-Tap AI Handoff

## Цель

Убрать лишний шаг между выбором матча в Telegram и полезным AI-ответом. Пользователь нажимает матч один раз, получает короткую оценку в чате и может одним нажатием открыть полный разбор того же fixture.

## Telegram flow

Для pre-match:

`match:menu:<fixtureId> → botAnalyzeFixture → botAiHandoffText → footballQuickAiHandoffKeyboard`.

Короткий бриф показывает идею/skip, исход, уверенность, риск, качество данных и причину.

Первая кнопка — `📊 Полный AI-разбор`.

LIVE и finished не запускают pre-match AI автоматически: для них сохраняется центр матча.

## Direct Mini App handoff

Полный разбор строит URL с параметрами:

`fixtureId=<id>&action=analysis&tab=brief&handoff=1`.

Mini App читает `handoff=1` и вызывает `analyzeMatch` напрямую. Повторного поиска, выбора клуба или fixture нет.

## Quota safety

Telegram quick brief использует `origin=telegram_quick`.

Если анализа ещё нет, он создаётся один раз и расходует одну дневную единицу.

После этого полный Mini App вызывает `/api/analyze` с обычным Mini App origin. Cached ветка возвращает результат до `incrementUsage`, поэтому handoff не списывает второй анализ.

При этом `full_ai` всё равно фиксируется — это важно для реальной launch funnel.

## Analytics

Telegram пишет `quick_ai` и `ai_handoff`. В metadata `ai_handoff` есть только `cached` и `source=match_select`; текст поискового запроса не сохраняется.

`/api/launch-funnel` возвращает агрегат `handoff.users`, `handoff.fullAiUsers`, `handoff.conversionPct`.

## Production gate

`oneTapHandoffDrill` проверяет структуру direct deep-link. Health и post-deploy smoke требуют все RC58 handoff flags. Новая миграция Supabase не требуется.