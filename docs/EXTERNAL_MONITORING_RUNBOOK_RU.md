# External Production Monitoring — MatchRadar

## Зачем

Внутренний Production Monitor выполняется внутри Cloudflare Worker и частично зависит от тех же сервисов, которые он проверяет. Поэтому нужен второй контур в другой failure domain.

Workflow `.github/workflows/external-production-monitor.yml` запускается на GitHub Actions runners и не использует секреты приложения.

## Что проверяется

Каждые 15 минут, со смещением относительно Worker cron, а также после каждого завершённого workflow `Deploy Production`:

- `/health/live` — Worker отвечает и процесс жив;
- `/health/ready` — Supabase, schema/security contract и обязательная конфигурация готовы;
- `/api/public-status` — публичный status endpoint доступен и возвращает распознаваемое состояние.

Каждая проверка выполняется максимум 3 раза с паузой 10 секунд. Это снижает риск ложного инцидента из-за единичного сетевого сбоя.

## Инцидент

Если после всех повторов production недоступен:

1. Workflow завершается красным.
2. В репозитории создаётся один открытый issue:
   `[monitor] MatchRadar production availability incident`
3. Следующие неуспешные проверки добавляют комментарии в этот же issue, а не создают новые.
4. JSON/Markdown evidence сохраняется как GitHub Actions artifact на 7 дней.

Когда внешний monitor снова проходит:

1. в issue добавляется recovery evidence;
2. issue автоматически закрывается;
3. workflow завершается зелёным.

## Политика

- Monitor не вызывает API-Football и другие платные data providers.
- Monitor не изменяет Supabase, runtime controls или пользовательские данные.
- Monitor не выполняет rollback автоматически.
- `maintenance` или `degraded` на публичном status endpoint фиксируется как warning, но доступность определяется прежде всего `/health/live` и `/health/ready`.
- Любой реальный `/health/ready = 503` после трёх попыток считается incident.

## Ограничения

GitHub scheduled workflows могут стартовать с задержкой, поэтому это внешний safety net, а не секундный pager. При росте проекта можно добавить Better Stack/аналогичный dedicated uptime + heartbeat сервис, не удаляя этот GitHub-контур.
