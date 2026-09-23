# RC67 — Media Campaign Publisher Kit

## Цель

После RC65/RC66 проект уже умеет распространять fixture deep-links и безопасно выдерживать вирусный трафик. RC67 превращает это в рабочий инструмент для запуска через СМИ и Telegram-каналы.

## Где находится

В админском разделе `🚀 Запуск и СМИ` добавлен блок `Ссылка для СМИ`.

Администратор задаёт:

- fixture ID;
- source;
- campaign;
- content/material.

## Что генерируется

- Telegram deep-link на конкретный fixture;
- готовый `start` parameter;
- текст публикации;
- Telegram Share URL для быстрой отправки в канал или личный чат.

## Атрибуция

Deep-link использует существующий формат RC65 и попадает в текущие `users/growth_events`. Новая таблица и новая Supabase migration не нужны.

Создание ссылки фиксирует событие `media_link_created`, а дальнейшие входы/AI-конверсия измеряются существующим Launch Funnel.

## Provider safety

Генератор сам по себе не делает запрос в API-Football. Названия команд и лига берутся из уже существующего fixture-card/analysis cache. Если cache пуст, ссылка всё равно создаётся по fixture ID.

## Доступ

`/api/media-publisher-link` доступен только администратору и защищён серверной проверкой `isAdminUser`; скрытие панели в UI не является единственной защитой.

## Production gate

`mediaPublisherDrill` проверяет round-trip fixture attribution и готовый publication copy. RC67 требует зелёные regression tests, verify:release, Worker dry-run и post-deploy smoke.