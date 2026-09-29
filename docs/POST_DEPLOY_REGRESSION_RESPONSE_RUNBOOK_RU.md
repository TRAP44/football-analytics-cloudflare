# Post-Deploy Regression Operational Response

Этот runbook описывает ручную реакцию администратора MatchRadar на post-deploy regression lifecycle.

## Состояния

- `HEALTHY` — активной регрессии нет.
- `WATCH` — ранний зрелый regression signal требует наблюдения, но ещё не означает подтверждённый incident.
- `INCIDENT` — regression policy подтвердила operational incident.
- `RECOVERED` — после WATCH или INCIDENT метрики вернулись в healthy state.

## Что показывает админ-панель

Раздел «Post-deploy regression» использует уже существующий release monitor и persistent `ops_events`.

Он показывает:

- последнее lifecycle state;
- время последнего transition;
- количество lifecycle events;
- статус alert delivery;
- короткий timeline WATCH / INCIDENT / RECOVERED и alert delivery;
- ручную рекомендацию оператору.

Раздел read-only: он не выполняет runtime mutation.

## WATCH

1. Не выполнять rollback только из-за одного WATCH.
2. Проверить, какое окно завершилось: 15/30/60 минут.
3. Дождаться следующего зрелого окна.
4. Проверить, повторяется ли regression signal.
5. Не менять provider, feature flags или runtime controls автоматически.

## INCIDENT

1. Сверить active deploy SHA и release.
2. Проверить signal code и соответствующий operational source.
3. Проверить Supabase/auth, provider, Telegram delivery, client error и latency signals.
4. Убедиться, что incident относится к текущему deployment generation.
5. Проверить доставку admin alert и отсутствие duplicate spam.
6. Решение о ручном rollback принимается отдельно по существующему release/rollback процессу.

Никакого автоматического rollback этот контур не выполняет.

## RECOVERED

1. Проверить, что recovery transition один.
2. Убедиться, что следующие healthy monitor runs не создают новый RECOVERED.
3. Проверить отсутствие новых error/critical после recovery.
4. Закрыть наблюдение только после стабильного следующего monitor run.

## Fail-soft

Ошибка отображения admin panel не должна влиять на production monitor, lifecycle persistence или alert delivery. UI только читает существующий release-monitor payload.

## Запрещённые автоматические действия

На этом этапе не добавляются:

- automatic rollback;
- automatic provider switch;
- automatic feature disable;
- automatic runtime-control mutation.
