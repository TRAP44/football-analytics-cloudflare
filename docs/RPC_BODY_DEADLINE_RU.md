# Дедлайн RPC до конца ответа — 16.10.2026

Проблема: `fetchWithTimeout` завершает таймер при получении headers. RPC вне очереди preauth/route мог затем неограниченно ждать `response.json()`. Таймаут renew из #934 при таком зависании не наступал и bounded retry не запускался.

`rawRpc` теперь держит абсолютный монотонный deadline от начала transport до окончания JSON. Таймер вызывает отмену и возвращает `UPSTREAM_TIMEOUT`; Promise.race ограничивает ожидание даже у transport/body, игнорирующего AbortSignal. После headers и JSON проверяется deadline, поэтому поздний успех не принимается даже при задержанном таймере. Таймер очищается в finally. Родительский signal очереди объединён с собственным через AbortSignal.any; ожидание в очереди по-прежнему входит в её общий срок.

Параметры timeout, правила guards и квот, SQL, UI не менялись. Сам RPC не повторяется. Только уже существующий renew retry из #934 может повторить продление с прежним owner token и достаточным запасом lockedUntil. Неизвестный исход claim/complete/платежа/списания не повторяется. Abort не доказывает отмену SQL в базе.

## Проверки

- 7 новых тестов: зависший body на200/503; transport без обработки abort; общий срок headers+body; поздние headers без чтения body; совместимость payload/ошибок PostgREST/malformed JSON; настоящий infrastructure helper; прохождение body timeout в существующий retry renew без replay complete.
- Три детерминированные регрессии проверены на прежнем main8a8b002d:0/3 pass,3 assertion failures. С исправлением40/40 профильных тестов прошли. Отдельный baseline с бесконечным body отменился Node из-за незавершённой Promise; не считается assertion-прогоном.
- Node22 npm ci/check/lint/security:privileged; release582/582; полный набор4244/4244; Worker dry-run прошли.
- Настоящий локальный workerd с общим infrastructure helper: зависший body RPC вне очереди вернул503 UPSTREAM_TIMEOUT за715мс при700мс; queued RPC — за712мс. Затем40конкурентных успешных RPC вернули свои ID. Всего42запроса,2зависших соединения закрыты, повторов нет. Предупреждений different-request/cross-request/hanging-promise не было. Локальные службы остановлены.

## Изолированная нагрузка

Тот же disposable PostgreSQL16.11/PostgREST16.4,39миграций, schema0169ec29ea39da9d085040ed825057a6,512MiB/1CPU/60connections, RESTpool20. Полный suite завершён до замеров.

| Параллельные клиенты | HTTP200 лента | HTTP200 готовый разбор | p95 готового разбора |
|---|---:|---:|---:|
|10|10|10|109,13мс|
|50|50|50|246,03мс|
|100|100|100|415,44мс|
|1000|10000|1000|2438,52мс|

Все четыре профиля прошли, ошибок HTTP/REST нет, externalBlocked0. На пике2085DB-запросов для1000cached-analysis; число guard claim не уменьшалось(2000). SQL evidence и paidProfilePreserved проверяются существующим runner. Это замер кандидата, не парное доказательство ускорения; цель устойчивого p95≤2с не заявляется.

Дополнительно существующий scheduled-lease load:1000lease,20SQL-параллельных;400ожидаемых продлений,600ожидаемых отказов;200потерянных ответов после commit восстановлены.1400попыток renew,800SQLrenew;1040claim,включая40конкурентов одной задачи→1владелец. Токены сохранены, сроки не сократились. Длительность4134мс,renewp95 159,92мс.

Изменения Supabase-клиента и новый тест добавлены в paths существующего Isolated Load and Resilience, чтобы CI повторял проверку на новых версиях клиента. Артефакты агрегированные, без токенов.

Production-нагрузка, Telegram-рассылки, API-Football и платежи не запускались. Локальные результаты не подтверждают вместимость hosted Cloudflare/Supabase Nano или холодного AI. productionCapacityConfirmed=false.
