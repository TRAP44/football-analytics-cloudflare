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
