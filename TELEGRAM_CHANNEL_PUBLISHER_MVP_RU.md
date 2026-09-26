# Telegram Channel Publisher MVP

Отдельный ручной publisher для канала **@MatchRadarFootball**.

## Границы этапа

- только ручная server-side публикация;
- Cron posting не подключён;
- AI-автогенерация постов не подключена;
- publisher использует отдельный `TELEGRAM_PUBLISHER_BOT_TOKEN`;
- основной `TELEGRAM_BOT_TOKEN` используется только существующим ботом и fixture deep-link contract;
- схема Supabase не меняется: idempotency использует существующий `analysis_cache`;
- `sendMessage` включён в manual MVP;
- `sendPhoto` подготовлен в модуле, но отдельный photo endpoint не открыт.

## Cloudflare config

Non-secret config хранится в `wrangler.jsonc`:

```text
TELEGRAM_CHANNEL_ID=@MatchRadarFootball
```

Secret нужно добавить вручную перед первой реальной публикацией:

```text
TELEGRAM_PUBLISHER_BOT_TOKEN=<token of @MatchRadarPublisherBot>
```

Publisher fail-closed, если secret отсутствует, channel ID некорректен или publisher token совпадает с основным bot token.

## Manual/admin test path

`POST /api/admin/channel-publisher/test`

Маршрут проходит обычную Telegram initData-аутентификацию и дополнительную server-side проверку `isAdminUser`. Public unauthenticated вызов получает 401.

По умолчанию endpoint работает как dry-run. Для реальной публикации нужно явно передать `"dryRun": false`.

Пример тела:

```json
{
  "fixtureId": 123456,
  "text": "⚽ MatchRadar Publisher MVP\nРучная публикация из backend. Автопостинг выключен.",
  "idempotencyKey": "channel-mvp-first-123456",
  "dryRun": false
}
```

CTA формируется server-side через существующий `fixtureTelegramDeepLink` с attribution `source=channel`, `campaign=publisher_mvp`, `content=manual`. Клиент не может подменить CTA URL.

Повтор того же explicit `idempotencyKey` или того же payload блокируется persistent idempotency ledger в существующем `analysis_cache`.
