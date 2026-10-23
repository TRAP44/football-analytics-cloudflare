# Первые официальные трансляции MatchRadar

Проверено 23 октября 2026. Планируемый эфир **24 октября с 08:55 МСК**, начало обоих матчей 09:00 МСК (06:00 UTC, 15:00 JST). Это предстоящие прямые эфиры, не архивные премьеры. Реальное воспроизведение внутри Telegram и доступность конкретного устройства ещё не подтверждены.

| Матч | Fixture API-Football | Официальная страница лиги | Конкретное видео |
| --- | --- | --- | --- |
| Kashima Antlers — Kashiwa Reysol | 1556114 | [J.LEAGUE,24Oct](https://www.jleague.jp/en/match/j1/2026/102407/) | [YouTube 6IqOyyLkj90](https://www.youtube.com/watch?v=6IqOyyLkj90) |
| Vissel Kobe — FC Machida Zelvia | 1556120 | [J.LEAGUE,24Oct](https://www.jleague.jp/en/match/j1/2026/102410/) | [YouTube 9lzAcSA6zy4](https://www.youtube.com/watch?v=9lzAcSA6zy4) |

## Подтверждение источника

[Официальный сайт J.LEAGUE](https://www.jleague.jp/en/) ссылается на международный канал `youtube.com/jleagueinternational` в footer и структурированных sameAs. Google Data API разрешил handle в channel ID `UCmQp6ZaAejJKKkXc_Y_lh1A`; этот ID закреплён в registry. Видео принадлежат именно этому каналу, публичные, без возрастного ограничения, embeddable=true, тип upcoming, scheduledStart 05:55 UTC. Региональная метаинформация разрешает RU/KZ/BY — эти три страны входят в первый каталог. Это проверка опубликованных ограничений правообладателя, не гарантия соединения с YouTube из любой сети.

Реальные защищённые запуски:

- [40012750842](https://github.com/TRAP44/football-analytics-cloudflare/actions/runs/40012750842): поиск для RU, оба конкретных видео. Research-status намеренно unverified; официальность установлена отдельным сопоставлением ссылки с сайта лиги и закреплением channel ID.
- [40013052102](https://github.com/TRAP44/football-analytics-cloudflare/actions/runs/40013052102): один guarded relay GET подтвердил Kashima 290 — Kashiwa 281, league98, **season 2027**, 24 октября 06:00 UTC.
- [40013125638](https://github.com/TRAP44/football-analytics-cloudflare/actions/runs/40013125638): один guarded relay GET подтвердил Vissel 289 — Machida 303 с теми же league/season/date.

Сезон 2027 — каноническое значение API-Football для сезона 2026/27. Не заменять его календарным 2026: сломается exact identity с Match Center. В manifests перенесены точные provider fixtureEvidence и время проверки, без выдуманных ID или кеша центра.

## Выпуск и проверка

В `src/match-watch-approvals.json` одобрены только эти два видео до 24 октября 10:00 UTC / 13:00 МСК. Refresh раз в 10 минут заново проверяет actual Google owner/status/type/time/region; каталог живёт максимум 30 минут. Отказ источника не продлевает TTL, завершённое видео не остаётся текущим LIVE. Нет новых provider вызовов на зрителя, права Telegram/платежи/AI не меняются.

После merge/deploy запустить **Refresh Match Watch**, проверить `published=2`, отсутствие `errorCode` и текущую выдачу. Подготовка допустима по проверенным fixtureEvidence не старше 48 часов даже до первого посетителя; публичная API-выдача всё равно требует свежий независимый Match Center. Панель и кнопка появляются только для совпадающего матча, после явного выбора страны. Плеер запускается по нажатию, отдельная официальная ссылка остаётся при ошибке embed.

Последний ручной шаг на настоящем телефоне: открыть матч из @MatchRadarAIBot, выбрать свою страну, проверить превью/ожидание эфира сейчас, затем воспроизведение/звук и fullscreen 24 октября. Среда разработки не имеет пользовательской Telegram-сессии, а YouTube web закрыт её proxy; браузерные smoke и метаданные не заменяют этот шаг.
