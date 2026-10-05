# External Production Monitoring — MatchRadar

## Зачем

Внутренний Production Monitor выполняется внутри Cloudflare Worker и частично зависит от тех же сервисов, которые он проверяет. Поэтому нужен второй контур в другой failure domain.

Основной workflow `.github/workflows/external-production-monitor.yml` запускается на GitHub-hosted `ubuntu-latest` и не использует секреты приложения. Self-hosted runner не является источником основного availability signal: он используется только как диагностический fallback после failure самого внешнего workflow.

## Что проверяется

Каждые 15 минут, со смещением относительно Worker cron, а также после каждого завершённого workflow `Deploy Production`:

- `/health/live` — Worker отвечает и процесс жив;
- `/health/ready` — Supabase, schema/security contract и обязательная конфигурация готовы;
- `/api/public-status` — публичный status endpoint доступен и возвращает распознаваемое состояние.

Каждая основная проверка выполняется максимум 3 раза с паузой 10 секунд. Это снижает риск ложного инцидента из-за единичного сетевого сбоя.

## Два разных класса failure

Красный workflow больше не считается автоматически доказательством падения production.

1. **Production availability failure** — внешний probe реально выполнился и health endpoints не прошли; diagnostic fallback также не подтверждает здоровье production.
2. **Monitor infrastructure failure** — workflow не дошёл до probe, завершился без шагов, либо production probe был успешным, а workflow упал позже на своей служебной логике.

После failure основного External Production Monitor автоматически запускается `.github/workflows/external-production-monitor-diagnostics.yml` на self-hosted runner. Он читает job/step metadata исходного run через GitHub API и, когда это нужно, повторяет только публичный health probe. Это позволяет отделить сбой приложения от сбоя GitHub-hosted execution/network/control-plane настолько, насколько это возможно без отдельного внешнего uptime-провайдера.

Incident lifecycle реализован через GitHub REST API из Node.js и **не зависит от установленного `gh` CLI**.

## Инциденты

Для реальной/подтверждённой недоступности production используется один issue:

`[monitor] MatchRadar production availability incident`

Для отказа инфраструктуры внешнего мониторинга используется отдельный issue:

`[monitor-infra] External Production Monitor execution failure`

Повторные failures добавляют комментарии в существующий issue вместо создания дубликатов. Когда основной внешний monitor снова успешно завершается, availability и monitor-infrastructure incidents закрываются с recovery evidence.

JSON/Markdown evidence основной проверки сохраняется как GitHub Actions artifact на 7 дней.

## Разобранный инцидент #464

Во время расследования был подтверждён как минимум один ложный красный run: production probe прошёл `/health/live`, `/health/ready` и `/api/public-status` с HTTP 200, после чего workflow упал на служебном шаге с `gh: command not found`. Это был failure monitor infrastructure, а не MatchRadar production.

После переноса основного monitor на `ubuntu-latest` также наблюдались runs, завершавшиеся до выполнения каких-либо шагов. Такие zero-step failures теперь явно классифицируются как monitor-infrastructure failures и проверяются fallback-контуром вместо автоматического объявления production outage.

## Политика

- Monitor не вызывает API-Football и другие платные data providers.
- Monitor не изменяет Supabase, runtime controls или пользовательские данные.
- Monitor не выполняет rollback автоматически.
- `maintenance` или `degraded` на публичном status endpoint фиксируется как warning, но доступность определяется прежде всего `/health/live` и `/health/ready`.
- Реальный `/health/ready = 503` после повторов и подтверждения fallback-контуром считается availability incident.
- Failure служебной логики после успешного production probe считается monitor-infrastructure incident.

## Ограничения

GitHub scheduled workflows могут стартовать с задержкой. Диагностический fallback тоже зависит от GitHub Actions orchestration и доступности self-hosted runner, поэтому это отказоустойчивый safety net, но не полностью независимый коммерческий pager. При росте проекта можно добавить Better Stack/аналогичный dedicated uptime + heartbeat сервис, не удаляя GitHub-контур.
