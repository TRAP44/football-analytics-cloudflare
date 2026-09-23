# RC68 — Media Campaign Control Room

## Цель

RC67 умеет создавать fixture deep-links для СМИ и Telegram-каналов. RC68 добавляет измерение результата каждого размещения: не только `source + campaign`, но и конкретный `content`.

## Что появилось

В админском разделе `🚀 Запуск и СМИ` добавлен блок `Материалы СМИ`.

Для каждого материала показываются:

- источник, кампания и content;
- число входов;
- открытия fixture deep-link;
- пользователи Quick AI;
- пользователи полного AI-разбора;
- конверсия вход → полный AI;
- число созданных publisher-ссылок.

Сводка показывает количество материалов, созданных ссылок, входы, Quick AI, полный AI и общую конверсию.

## Атрибуция

Используется существующая таблица `growth_events` из v6.15. Новая Supabase migration не нужна.

Событие `media_link_created` теперь записывает attribution той ссылки, которую администратор создаёт (`source / campaign / content`), а не first-touch самого администратора. Это позволяет связать publisher activity с результатом конкретного материала.

## Privacy

API возвращает только агрегаты. Telegram ID и поисковые запросы пользователей в control room не выдаются.

## Provider safety

RC68 не добавляет запросов в API-Football. Статистика строится только по first-party `growth_events`.

## Production gate

RC68 требует:

- deterministic `mediaCampaignControlDrill`;
- regression test `media-campaign-control-rc68.test.js`;
- `verify:release`;
- Worker dry-run;
- post-deploy smoke с RC68 health flags.
