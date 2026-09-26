# Primary Telegram Bot Migration Preparation

Baseline: `65a941b52b3df6792ec16d5b520482ff57c72e70`.

Цель этапа — подготовить безопасный будущий cutover основного пользовательского Telegram-бота на брендированный **MatchRadar AI** без смены production `TELEGRAM_BOT_TOKEN` в этом релизе.

## Проверенный identity contract

- Primary bot: `TELEGRAM_BOT_TOKEN`.
- Mini App auth: Telegram `initData` валидируется HMAC-ключом текущего `TELEGRAM_BOT_TOKEN`.
- Webhook route остаётся `POST /telegram/webhook`; billing webhook probe также ожидает этот URL.
- Bot identity/username получается через Telegram `getMe`.
- Fixture/share deep-links строятся с username текущего primary bot.
- `/start` attribution остаётся привязанной к Telegram user id и start parameter.
- Reminders отправляются primary bot на сохранённый `telegram_id`.
- Billing hooks используют primary bot token; monetization остаётся выключенной.
- Main Mini App URLs строятся от origin Worker/Mini App и не зависят от bot username.
- Пользовательские данные в Supabase остаются keyed by `telegram_id`; миграция схемы не нужна.
- Publisher Bot остаётся отдельным: `TELEGRAM_PUBLISHER_BOT_TOKEN` + `TELEGRAM_CHANNEL_ID=@MatchRadarFootball`.

## Username cache migration safety

Старый глобальный ключ `telegram:bot-username:v1` больше не читается.

Новый ключ `telegram:bot-username:v2:<fingerprint>` identity-aware: fingerprint — односторонний SHA-256 fingerprint текущего primary bot token. Сам token не записывается в cache payload/key и не логируется. Поэтому смена `TELEGRAM_BOT_TOKEN` гарантирует cache miss и новый `getMe`, а fixture/share deep-links не могут получить username старого bot identity из старого cache.

TTL username cache остаётся 1440 минут, но теперь изолирован по primary bot token.

## Что этот этап НЕ меняет

- production `TELEGRAM_BOT_TOKEN`;
- старого primary bot и его webhook;
- `TELEGRAM_PUBLISHER_BOT_TOKEN`;
- Telegram channel;
- football provider / AI;
- Supabase schema;
- monetization;
- public navigation;
- публичные Mini App URLs.

## Cutover checklist — выполнить отдельным этапом

1. В BotFather завершить branding нового primary bot: display name **MatchRadar AI**, username, avatar, description/short description.
2. Получить новый bot token и сохранить его только как production secret; не помещать token в Git, логи, issue/PR или документацию.
3. До смены secret вызвать Telegram `getMe` для нового token вне приложения и сверить `id`, `username` и `is_bot=true`.
4. Проверить, что новый username свободно открывается как `https://t.me/<new_username>`.
5. Зафиксировать production Mini App origin и будущий webhook URL: `https://<production-origin>/telegram/webhook`.
6. Настроить у нового bot Menu Button / Main Mini App на тот же production Mini App URL.
7. Настроить webhook нового bot на существующий `/telegram/webhook` с текущим `TELEGRAM_WEBHOOK_SECRET`; убедиться, что `getWebhookInfo.url` совпадает с production URL.
8. Только после шагов 1–7 заменить production secret `TELEGRAM_BOT_TOKEN` на token нового MatchRadar AI bot. Не менять `TELEGRAM_PUBLISHER_BOT_TOKEN`.
9. Выполнить production deploy/restart с сохранением остальных vars/secrets.
10. Проверить `getMe` через приложение: username должен быть новым; старый `telegram:bot-username:v1` не используется.
11. Проверить fixture/share deep-link: ссылка должна вести только на новый username и корректно открывать нужный матч через `/start`.
12. Открыть Mini App из нового bot и проверить валидный `initData`; initData старого bot после cutover не должен проходить primary validation.
13. Проверить `/start` без payload и с fixture attribution payload.
14. Проверить Telegram flow: поиск → матч → Quick AI → полный анализ → назад/закрытие Mini App.
15. Проверить reminders на тестовом пользователе: сообщение должно прийти от нового primary bot, а существующая запись пользователя/напоминания должна остаться по тому же Telegram user id.
16. Проверить billing endpoints только на fail-closed контракт при disabled monetization; платежи не включать.
17. Проверить Publisher Bot отдельно: manual publisher использует только `TELEGRAM_PUBLISHER_BOT_TOKEN`, канал остаётся `@MatchRadarFootball`.
18. Проверить production smoke, release readiness, webhook status и отсутствие secret/token в логах.
19. После успешного smoke не удалять пользовательские данные и не выполнять Supabase migration.
20. Старого `@MANAGERPLAYER_BOT` отключать/перенаправлять только отдельным решением после подтверждённого периода стабильности нового MatchRadar AI bot.

## Target-specific cutover addendum

Целевой новый primary bot: @MatchRadarAIBot.
Текущий production primary bot до cutover: @MANAGERPLAYER_BOT.

Runtime не хардкодит новый username. После будущей замены TELEGRAM_BOT_TOKEN первый lookup нового identity namespace обязан вызвать getMe; ожидаемый username — MatchRadarAIBot. Fixture deep-link, /api/share-link, Telegram share card и channel publisher CTA используют общий fixtureTelegramDeepLink и поэтому автоматически переключатся на новый username.

### Exact cutover checklist

1. В BotFather проверить @MatchRadarAIBot: display name MatchRadar AI, username, avatar, description и short description.
2. Получить новый bot token и хранить его только как production secret. Raw token не помещать в Git, PR, issue, документы или логи.
3. До production cutover выполнить getMe новым token и проверить is_bot=true и username=MatchRadarAIBot.
4. Зафиксировать текущий production Mini App origin и URL https://<production-origin>/telegram/webhook.
5. Настроить Main Mini App/Menu Button @MatchRadarAIBot на тот же production Mini App URL.
6. TELEGRAM_WEBHOOK_SECRET по умолчанию не менять. Rotation делать только при security-причине.
7. Если rotation нужна, подготовить новое значение в secret manager и использовать одно и то же значение в production TELEGRAM_WEBHOOK_SECRET и Telegram setWebhook.secret_token. Не логировать secret.
8. Установить webhook нового bot на существующий endpoint /telegram/webhook с выбранным secret_token. Старого @MANAGERPLAYER_BOT пока не отключать.
9. Выполнить getWebhookInfo новым token: URL должен точно совпадать с production /telegram/webhook, last_error_message не должен содержать критическую ошибку.
10. Только после этих проверок заменить production TELEGRAM_BOT_TOKEN на token @MatchRadarAIBot. Publisher token не менять.
11. Если выполнялась rotation webhook secret, одновременно обновить production TELEGRAM_WEBHOOK_SECRET. Worker и Telegram не должны иметь разные значения.
12. Запустить штатный production deploy с сохранением остальных vars/secrets.
13. Проверить getMe через current primary identity: username должен быть MatchRadarAIBot.
14. Проверить getWebhookInfo после deploy.
15. Проверить /start без payload и /start с fixture attribution payload.
16. Открыть Main Mini App из @MatchRadarAIBot и проверить Telegram initData.
17. InitData нового bot должен проходить current primary-token validation; initData старого token после cutover не должен проходить.
18. Проверить GET /api/me: тот же Telegram user ID, прежние favorites, reminders, preferences и корректный admin flag.
19. Для admin Telegram ID проверить защищенный admin endpoint/UI; admin access должен сохраниться по Telegram user ID.
20. Проверить fixture deep-link: URL должен начинаться с https://t.me/MatchRadarAIBot?start= и не содержать MANAGERPLAYER_BOT.
21. Проверить /api/share-link и Telegram share card — они должны вести на @MatchRadarAIBot.
22. Выполнить channel publisher dry-run: CTA должен вести на @MatchRadarAIBot, а отправитель остается отдельным Publisher Bot.
23. Проверить reminders существующего пользователя: запись остается keyed by telegram_id, сообщение приходит от нового primary bot.
24. Проверить history/favorites/preferences без миграции данных.
25. Billing endpoints при disabled monetization должны оставаться fail-closed; платежи не включать.
26. Проверить Release Readiness, /health, production smoke и отсутствие raw token/secret в логах.
27. Старого @MANAGERPLAYER_BOT не удалять и не отзывать сразу после cutover.

### Rollback procedure

1. При проблемах остановить дальнейшие изменения; Publisher Bot и Telegram channel не трогать.
2. Вернуть production TELEGRAM_BOT_TOKEN на ранее сохраненный secret @MANAGERPLAYER_BOT.
3. Если TELEGRAM_WEBHOOK_SECRET не ротировался — оставить его без изменений.
4. Если secret ротировался, предпочтительно оставить новый secret и переустановить webhook старого bot с тем же secret_token; альтернативно восстановить старый secret одновременно и в Worker, и в Telegram webhook.
5. Переустановить webhook @MANAGERPLAYER_BOT на тот же /telegram/webhook.
6. Выполнить production deploy с восстановленным primary token/secret.
7. Проверить getMe: current primary username снова MANAGERPLAYER_BOT.
8. Проверить getWebhookInfo, /start, Main Mini App, Telegram initData и GET /api/me.
9. Проверить fixture/share deep-link: identity-aware v2 cache должен автоматически использовать namespace старого token; ручная очистка cache не требуется.
10. Проверить reminders и admin access по тем же Telegram user IDs.
11. Выполнить production smoke/readiness.
12. @MatchRadarAIBot не удалять; повторный cutover выполнять отдельным change window после root-cause fix.

### Stop point

На preparation stage не выполняются: замена production TELEGRAM_BOT_TOKEN, rotation TELEGRAM_WEBHOOK_SECRET, ручной setWebhook нового bot или отключение @MANAGERPLAYER_BOT.
