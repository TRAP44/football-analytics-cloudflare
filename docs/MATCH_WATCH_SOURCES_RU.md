# «Где смотреть»: источники и решение для первого выпуска

Проверено 23 октября 2026. Задачи: [#944](https://github.com/TRAP44/football-analytics-cloudflare/issues/944), общий план [#943](https://github.com/TRAP44/football-analytics-cloudflare/issues/943).

## Результат

Бесплатный источник, который одновременно подтверждает конкретный матч API-Football, страну, действующую ссылку на эфир и разрешение встроенного просмотра всех главных турниров, **не найден**. Это результат проверки перечисленных ниже кандидатов, а не утверждение, что таких партнёрств нигде не существует.

Для первого встроенного просмотра выбран **официальный YouTube IFrame Player**, только для отдельных эфиров проверенных правообладателей. Для проверки видео нужен YouTube Data API; ключа Cloudflare, Supabase или футбольной статистики недостаточно. Доступ к конкретному актуальному футбольному эфиру и его территориям пока не подтверждён: это обязательное условие реализации/выпуска, а не зелёная галочка по наличию iframe API.

Для TV-метаданных исследован TheSportsDB: опубликованный бесплатный API работает и иногда содержит прямой `idAPIfootball`. Но он не возвращает ссылку на просмотр и не доказывает права/доступность плеера. **Не покупать его или Sportmonks ради обещания готовых видеотрансляций.** Общий каталог может позднее объединять несколько источников, сохраняя их разные возможности.

Пользовательская функция сейчас **не реализована и не включена**. Пустую кнопку, произвольную главную страницу вещателя и чужой видеопоток за работающую трансляцию не выдаём. Основной матч-центр, AI, CSP и production bindings этим исследованием не менялись; покупок/регистраций не было.

## Что проверено

| Источник | Что подтверждено | Встраивание и ограничения | Решение |
| --- | --- | --- | --- |
| YouTube официальных каналов | Документированы API видео, канала, LIVE-метаданные, `status.embeddable`, `contentDetails.regionRestriction`, IFrame Player API | Разрешённый официальный iframe с требованиями YouTube; сам факт наличия видео не подтверждает полномочия канала. Нужна проверка реального видео через Data API и явная страна. Из среды страницы `youtube.com/@…/streams` недоступны через proxy, поэтому реальное воспроизведение не проверено | Первый кандидат на отдельные бесплатные официальные эфиры; не обещать все топ-матчи |
| TheSportsDB | Официальные endpoints `eventsday`, `lookupevent`, `lookuptv`; в живом ответе есть event ID, иногда API-Football ID, страна, TV-канал | Это редакционные/сообщественные метаданные, не правообладатель и не видеоплеер. В проверенных TV-строках нет playback URL. Free lookup TV ограничен двумя результатами, выборка стран неполная | Только дополнительная TV-справка после проверки соответствия; не источник кнопки «Смотреть» |
| Sportmonks | `include=tvStations.tvStation;tvStations.country`; TV-метаданные входят в таблицу данных тарифов; не каждый матч покрыт | Ключ `tvstations` lowercase; записи junction по стране. Документированный URL Sky Sports — главная страница, не эфир матча. Разрешения на видеовстраивание это не даёт | Не выбирать платный API до проверки нужных лиг/стран и отдельного источника playback URL |
| FIFA+ / DAZN | `plus.fifa.com` перенаправляет в FIFA+ DAZN; каталог содержит отдельные разделы «Live and Coming Up», «Full Event Replays & Highlights» и конкретные страницы событий | Есть регистрация/зависимость от страны. Публичный embed/API договор для нашего проекта не подтверждён. Локализованный URL `en-US` не доказывает доступность просмотра в США или РФ | Кандидат официальных внешних ссылок после точного матча/времени/территории; автоматический скрейпинг не внедрять |
| UEFA.tv | Главная/FAQ отвечают HTTP200, содержимое из среды — JS shell | Ни конкретный действующий эфир, ни разрешение на iframe, ни территориальное покрытие этим ответом не установлены | Не подключён как готовый плеер |
| Okko | Страница спорта из среды отвечает HTTP403 | Это ограничение доступа из среды, не доказательство отсутствия партнёрства. Нет подтверждённого официального embed/API соглашения. Не извлекать защищённые потоки | Внешняя ссылка на подтверждённое событие, когда есть источник; встроенный просмотр не обещан |
| API-Football PRO | В проекте уже используется как источник матчей/статистики | Текущая документационная страница из среды не дала проверяемый каталог TV/видео; наличие TV/playback API и лицензии в подписке не установлено | Не считать существующий футбольный ключ ключом от трансляций |
| ScoreBat | Публичная страница video-api доступна, но читаемого договора/API данных для LIVE проверка не дала | Заголовок «Live Stream» не является подтверждением разрешённых потоков конкретного матча | Не выбран; не подменять LIVE хайлайтами |

## Тарифы, лимиты и условия

Все цены — опубликованные при проверке, без налогов/индивидуального договора; ничего не покупалось.

- **YouTube Data API:** нужен Google Cloud project с включённым API и API key для публичных метаданных. OAuth пользователя для чтения публичных видео не нужен. Актуальная документация квот: отдельные buckets `search.list` и `videos.insert` по100 вызовов/сутки, остальные endpoints —10 000 units/сутки; `videos.list` стоит1unit. Сброс в полночь Pacific Time, не UTC. Старую формулу «100units за search» не закладывать без сверки текущей квоты проекта. Это не обещание неограниченной бесплатной ёмкости. Видео не скачивать/не проксировать через Worker.
- **TheSportsDB Free:** опубликованный публичный demo key `123`,30requests/min; `lookuptv` Free Limit2, Premium Limit100. По Terms от17.09.2026 бесплатный API разрешён для development projects, публикация в app store требует paid subscription. Коммерческий Telegram-продукт нельзя автоматически приравнивать к разрешённому development project: до production проверить подходящий тариф/письменное подтверждение. API endpoints разрешены, scraping сайта запрещён. Для paid API требуется указать источник. Изображения имеют отдельные права; исследование их не использует.
- **TheSportsDB цены:** Single Developer$9/month; Small Business$20/month. Более высокий тариф не превращает TV-список в право на видеопоток.
- **Sportmonks:** бесплатный план Danish Superliga и Scottish Premiership, включая play-offs; не все ведущие лиги мира. Starter от€29/month при помесячной оплате,€24/month при годовой,5 выбранных лиг,2 000calls/entity/hour. Данные о TV не равны разрешённому embed. Пробный период и регистрация не выполнялись.
- **FIFA+/DAZN, UEFA.tv, Okko:** не подтверждён тариф/API договор для повторного использования каталога и embed в нашем продукте. Надпись «Watch free» в общей странице не позволяет пометить любой конкретный матч бесплатным или доступным в России.

Официальные документы:

1. [YouTube Getting started](https://developers.google.com/youtube/v3/getting-started), [Videos resource](https://developers.google.com/youtube/v3/docs/videos), [Videos list](https://developers.google.com/youtube/v3/docs/videos/list), [Quota costs](https://developers.google.com/youtube/v3/determine_quota_cost).
2. [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), [Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Player parameters](https://developers.google.com/youtube/player_parameters).
3. [TheSportsDB documentation](https://www.thesportsdb.com/documentation), [Terms](https://www.thesportsdb.com/docs_terms_of_use.php), [Pricing](https://www.thesportsdb.com/pricing).
4. [Sportmonks TV stations](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/tv-stations), [Pricing](https://www.sportmonks.com/football-api/plans-pricing/), [Free plan](https://www.sportmonks.com/football-api/free-plan/).
5. [FIFA+](https://www.plus.fifa.com/), [UEFA.tv FAQ](https://www.uefa.tv/faq), [Okko Sport](https://okko.tv/sport), [API-Football documentation](https://www.api-football.com/documentation-v3), [ScoreBat API page](https://www.scorebat.com/video-api/).

## Реальные примеры: что нельзя превращать в эфир

Сокращённые публичные ответы без картинок, ключей проекта и персональных данных сохранены в [JSON-выборке](research/MATCH_WATCH_SOURCE_SAMPLES_2026-10-23.json). Это ограниченная выборка бесплатного API, не оценка покрытия сервиса.

| Матч / запись | Сопоставление и страна | Результат проверки |
| --- | --- | --- |
| Gimnasia y Esgrima de La Plata — Sarmiento,23.10.2026 | TheSportsDB2398151 → API-Football1493202; Argentina, ESPN Premium Argentina | Основная карточка21:00UTC, TV-строка22:00. Несогласованное время и отсутствие playback URL: кнопку эфира не показывать |
| Gimnasia y Esgrima de Mendoza — Platense,23.10.2026 | TheSportsDB2398152 → API-Football1493203; Argentina, TNT Sports Argentina | Время21:30 совпадает, но URL эфира и право embed отсутствуют. Только TV-метаданные, не проверенный поток |
| One Knoxville — South Georgia Tormenta,23.10.2026 | TheSportsDB2397702 → API-Football1494048 | `tvevent:null`. Это отсутствие сведений в выборке, а не доказательство отсутствия трансляций |
| Aston Villa — Liverpool,04.10.2020 | TheSportsDB1032723 → API-Football592172, statusFT, `strVideo` содержит YouTube URL | Историческая видеоссылка. По одному полю нельзя доказать LIVE, полный повтор, официальный канал или разрешённые страны; не выдавать за текущий эфир |
| Marrakesh E-Prix,12.01.2019 | Официальный пример `lookuptv?id=584911`, Ireland/BT Sport | Исторический Motorsport, не футбол. Рабочий пример endpoint не доказывает футбольное покрытие |
| Wellington United — Waterside Karori, National Women's League NZ | [Конкретная страница DAZN en-US](https://www.dazn.com/en-US/home/n7550q1e866t0a92ocvkmwmtu0/i4tekq44fgnd1a9hdsn4yq9jg), из раздела Live and Coming Up | HTTP200 и название события проверены. Дата/fixtureId/доступ для выбранной страны/право embed не подтверждены. В product catalogue не импортирован |
| Shabab Al Ahli — Al Ain | FIFA+/DAZN разместил событие в **Full Event Replays & Highlights** | Заголовок команды не делает запись прямой трансляцией. До отдельного proof не считать LIVE/полным replay |

Воспроизводимые read-only запросы с опубликованным demo credential:

```text
GET https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-10-23&s=Soccer
GET https://www.thesportsdb.com/api/v1/json/123/lookuptv.php?id=2398151
GET https://www.thesportsdb.com/api/v1/json/123/lookuptv.php?id=2398152
GET https://www.thesportsdb.com/api/v1/json/123/lookuptv.php?id=2397702
GET https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=1032723
```

## Проверка имеющегося доступа

- В `src/`, `.env.example`, `wrangler.jsonc` и references существующих workflows не обнаружена подключённая интеграция YouTube/Sportmonks/TheSportsDB. Это проверка конфигурации репозитория, не утверждение об отсутствии любых внешних аккаунтов владельца.
- Команды просмотра **имён** GitHub repository и production environment secrets вернули403 `Resource not accessible by integration`. Значения не запрашивались/не извлекались. Поэтому наличие отдельного YouTube key в GitHub неизвестно; повторно требовать заменить рабочие Cloudflare/Supabase tokens не нужно.
- Managed environment не объявила ready bindings для этих video/TV API. Не трактовать отсутствие объявленной связи как проверенный отказ внешнего аккаунта.
- Нативная Telegram-сессия и воспроизведение на телефоне не тестировались. HTTP200 документации/страницы не является playback smoke.

## Контракт будущей реализации

Разделить **catalogueProvider** (метаданные вещателя) и **playbackProvider** (разрешённый просмотр). Запись: `fixtureId`, стабильные ID команд/турнира и тип команды, `kickoffUtc`, `countryIso2`, `providerEventId`, `kind=live|replay|highlights`, `access=free|subscription|ppv|unknown`, официальный `eventUrl`, `embedProvider/videoId`, `verifiedAt/expiresAt`, источник и результат подтверждения прав/территории.

1. Сопоставлять не только названия: оба клуба, турнир, время UTC, женщины/молодёжь, отсутствие переноса/отмены. Даже прямой `idAPIfootball` не отменяет проверки остальных полей. Несогласованность времён и неоднозначные ID → пропуск.
2. Страна выбирается явно; язык Telegram/страна проведения матча не определяют страну пользователя. Переключение страны меняет ключ кеша и отменяет устаревший ответ. Нельзя выводить мировой доступ из одной локализованной страницы.
3. Для YouTube: фиксированный список каналов, подтверждённых ссылкой с официального сайта правообладателя, и server-side `videos.list(part=snippet,status,contentDetails,liveStreamingDetails)`; проверить channelId, embeddable, public status, время и regionRestrictions. Тип видео и статус LIVE уточнять по фактическому времени, а не названию. Отсутствие метаданных → не подтверждено. Даже успешный API response не гарантирует playback в Telegram/доступность YouTube из страны.
4. Только HTTPS официальных точных доменов и разрешённых event URL; без произвольного server fetch/SSRF, редиректов на внутренние адреса и сохранения токенизированных playback URL. iframe URL строится из проверенного videoId, не приходит произвольным HTML от клиента.
5. Кеш и поиск вне критического пути открытия/AI. Видео и iframe загружаются только после нажатия; неизвестный/отрицательный/просроченный результат не создаёт пустую кнопку. Дедупа/negative cache/global provider budgets обязательны, quota не тратится отдельно на каждого пользователя. AI-квота не используется.
6. Сейчас CSP запрещает внешние frame, а Referrer-Policy=`no-referrer`. При реальном включении разрешить только конкретный playback host и нужные плееру scripts/connect; Referer — минимально необходимый, например origin через `strict-origin-when-cross-origin`. Не ослаблять API/админские headers целиком. Если Telegram WebView не даёт достаточный Referer и возникает153 — официальный переход, без обхода защиты.
7. Обработать YouTube100/101/150/153, запрет autoplay, загрузку/таймаут, уход со страницы, смену матча/страны. При допустимом источнике предлагать официальный переход. Не скрывать рекламу/брендинг/управление YouTube, не извлекать raw stream и не требовать покупки AI для просмотра. Проверить применимые условия API-клиента, privacy и атрибуцию до включения.
8. Кнопка бота использует ту же проверенную запись; новые/истёкшие эфировые ссылки не подставляются независимо от Mini App. Нельзя выдавать страничку FIFA+/UEFA.tv/Okko Sport за конкретный матч.

## Условия продолжения и приёмки

Сейчас блокируется **подтверждение действующего источника**, а не скорость/AI/избранное:

- Для первого встроенного YouTube-эфира нужен доступ к YouTube Data API и подтверждённый официальный канал/конкретное видео с матчем и территорией. Если отдельный key уже есть, использовать существующий серверный secret; если нет — создать ограниченный бесплатный key, не просить его в чате и не включать платные услуги. Приложение с таким key ещё не реализовано, добавление key само по себе функцию не включает.
- Для top matches в РФ нужен проверенный официальный event URL/каталог российского вещателя и его условия. Бесплатный YouTube key не открывает Okko и не даёт права на АПЛ/ЛЧ, отсутствующие на официальном YouTube.
- До любой покупки сначала проверить предоставляемые поля и реальные матчи/страны: каталог TV без event URL не решает исходную задачу. Регистрации, billing и переговоры от имени владельца без его поручения не начинать.

Приёмка первого работающего сценария: действующий футбольный fixtureId + выбранная страна → подтверждённое видео официального канала → playback в Telegram iOS/Android; fallback для embed refusal; отсутствие пустых кнопок/влияния на открытие матч-центра/AI. Затем расширение источников. Тестовые данные, исторические ссылки и HTTP200 документации не закрывают этот gate.

## Подключение сохранённого ключа — 23 октября

Сергей создал Google Cloud project `matchradar-512512`, включил YouTube Data API v3 и подтвердил сохранение `YOUTUBE_DATA_API_KEY` в GitHub repository secrets. Значение не получаем и не переносим в public/ или логи. Реальная работоспособность проверяется отдельно, не выводится из сообщения о сохранении.

В существующий main-only `Observe Live Usage` добавлен optional `inspect_watch=false`. Запуск из `main` с `inspect_watch=true` в защищённом окружении `background-jobs` читает ключ в одном серверном шаге. Отдельный шаг продолжится при ошибке агрегированного наблюдения, но не после отмены задания. Существующий аудит privileges разрешает только это новое имя секрета; права workflow, main-only guard и pinned actions сохраняются.

`scripts/inspect-match-watch.js` выполняет до4GET YouTube, включая ровно2search(live/upcoming, по10 результатов), без пагинации/повторов; один GET существующего свежего public cache на сегодня/завтра. API key передаётся только Google в заголовке `X-Goog-Api-Key`, ключ Supabase — только настроенному `*.supabase.co` в `apikey`. Redirects запрещены, размеры ответов/сроки ограничены; ошибки только фиксированные категории без raw response/URL/error. Пользовательские таблицы, Telegram, новые запросы API-Football, SQL и production writes не используются.

Для первого источника закреплён FIFA channel ID `UCpcTrCXblq78GZrTUTLWeBw`, handle `fifa`; [официальный сайт Inside FIFA](https://inside.fifa.com/) в social footer подтверждает `https://www.youtube.com/fifa`. Ответ `channels.list` обязан подтвердить и ID, и handle до поиска видео. Видеозаписи другого канала отбрасываются повторно.

Артефакт `load-results/match-watch-source-check.json` содержит только публичные video ID/title/time, public/embeddable/age/region metadata и максимум10 совпадений названий+времени с кешем. Они **кандидаты на ручную проверку**: совпадение названия и пяти минут не подтверждает турнир, возраст/пол, права и реальное воспроизведение. `featureReady`, `fixtureVerified`, `playbackVerified` всегдаfalse у этого source-inspection, даже при успешном API. Отсутствие `contentDetails`/невалидные region restrictions → unknown, не мировой доступ. Истёкшие/будущие противоречивые LIVE времена не считаются текущим эфиром. Отсутствие кандидатов в таком ограниченном сканировании не означает отсутствие иных официальных трансляций.

После merge: `gh workflow run live-usage-report.yml --ref main -f inspect_watch=true`, скачать только sanitized artifact и зафиксировать реальный результат перед реализацией пользовательского плеера. PR с этим кодом не является готовым встроенным просмотром.
