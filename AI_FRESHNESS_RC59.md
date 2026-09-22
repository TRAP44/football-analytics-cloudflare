# RC59 — AI Freshness Guard & Pre-Kickoff Recheck

## Зачем

Сохранённый AI не должен выглядеть одинаково надёжным за 8 часов и за 8 минут до матча. Чем ближе kickoff, тем быстрее меняются составы, травмы, рынок и подтверждённые данные.

## Freshness policy

Динамическое окно уменьшается по мере приближения матча:

`45 → 20 → 10 → 5 → 3 минут`.

- больше 6 часов до старта: 45 минут;
- 2–6 часов: 20 минут;
- 45–120 минут: 10 минут;
- 15–45 минут: 5 минут;
- последние 15 минут: 3 минуты.

Если до старта не больше 90 минут и оба стартовых состава ещё не подтверждены, окно ограничивается максимум 5 минутами.

## Server behavior

`analysisFreshness(payload)` возвращает динамический статус `fresh`, `recheck` или `started` и machine-safe `reasonCode`.

Клиенты отправляют `recheck=true`. Если snapshot ещё свежий, backend сразу отдаёт cache. Если динамическое окно истекло, backend делает новый расчёт.

Provider rate-limit не уничтожает старый анализ: backend возвращает stale snapshot, но вместе с честным freshness-state и причиной.

## Quota safety

Повторная перепроверка бесплатна только если этот пользователь уже имеет данный `fixture_id` в `analysis_history`.

Это означает:

- первый анализ пользователя продолжает расходовать обычную дневную единицу;
- повторный pre-kickoff recheck того же fixture не списывает лимит второй раз;
- бесплатный recheck работает даже если дневной лимит уже равен нулю;
- общий cache другого пользователя сам по себе не даёт право на free recheck.

## Telegram

One-tap brief автоматически просит conditional recheck и показывает возраст AI, freshness label и причину. LIVE/finished остаются в Match Center.

## Mini App / History

Полный анализ по умолчанию отправляет `recheck=true`. Freshness-card показывает возраст snapshot и кнопку `Перепроверить AI сейчас`, если окно истекло.

History тоже вычисляет freshness на момент открытия; старый snapshot не маскируется как свежий.

## Analytics / privacy

`analysis_recheck` хранит только `fixtureId`, `free` и machine-safe `reason`; не нужно хранить текст поискового запроса. `/api/launch-funnel.rechecks` отдаёт агрегаты total/free/charged.

## Production gate

Deterministic self-test проверяет три сценария: stale near kickoff, fresh near kickoff и fresh far from kickoff. Новая миграция Supabase не требуется.