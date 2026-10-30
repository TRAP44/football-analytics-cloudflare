# Полные записи вне смешанной ленты видео

Дополнение к [ISL](MATCH_WATCH_ISL_RU.md). Во время выпуска #1037 английская Goa—SC Delhi (`Ay1gYmJoFMk`, fixture1642184) вышла из последних20uploads, заполненных короткими роликами. Исторические metadata и независимый canonical match сохранены, но они не доказывают её нынешнее присутствие в поисковой выдаче. Новый механизм должен подтвердить это реальным Google-запросом после выпуска.

## Поиск и допуск

Только для официального ISL-канала `UCJk-aQ7NZtqYtpcqKDt_vZg` добавлен независимый `search(eventType=completed,type=video,order=date,regionCode=RU,maxResults=10)` раз в12часов. Пагинации нет. Параметр publishedAfter не используется: эфир мог быть анонсирован раньше, чем закончился; срок записи ограничивается канонической датой матча и настоящими actualStart/actualEnd. Интервалы live/upcoming и последних20uploads остаются прежними.

Результат completed-search — только ID-кандидат. Архивы другого сезона, press/watchalong/клипы, чужой канал, Hindi/Vertical, неподтверждённые дата/команды/сезон/тур/счёт, незавершённый canonical match, неверная фаза или права не получают публикации. Все прежние ISL producer/consumer guards и семидневный максимум сохраняются. Допустимость в RU/KZ/BY, public/age/embed и phase перепроверяются свежим videos-запросом. После привязки запись продолжает проверяться через fixture bindings, даже если уйдёт из обоих списков.

Discoveryv6 сохраняется отдельным ключом, читает v5/v4/v3/v2/v1 без изменения старых rollback snapshots. completedFeeds допускает один известный канал, до10валидныхID и attemptedAt не в будущем. Попытка фиксируется до сетевого обращения. После проверки bounds найденные IDs записываются отдельным durable checkpoint до запросов metadata/fixtures: временный сбой не теряет находку на следующие12часов. Этот checkpoint не содержит approvals. Неизвестный исход записи прерывает run до metadata/publication.

Ошибка completed-search сохраняет предыдущие ID и прежний12часовой интервал, при этом их права проверяются заново. Успешный пустой поиск не является запретом уже привязанной публичной записи; запрет/удаление определяется свежими metadata. Сбой нового поиска не прекращает независимые feeds остальных каналов.

## Квоты и наблюдение

До480feedID (раньше470), плюс200bound+20manual:700uniqueID. Это всё ещё14пакетов videos, максимум29Google-запросов/run вместо28. Worst-case стандартной суточной квоты:9324+200search=9524units/day при10000, запас476разделяется с административными проверками. Это расчёт, не измерение реальной квоты аккаунта. Для API-Football не добавлено вызовов, лиг или новых прав; общий2dates/run16attempts/day/minute/FREEreserve сохранён. В обычном просмотре источники не ищутся.

Существующая защищённая main-only Observe Live Usage поддерживает `watch_feed=completed`: channels→одна completed search→videos, не более3запросов/102units; не читает user data и не публикует источники. Максимальный общий inspector budget4calls прежний, ключ в X-Goog-Api-Key, host фиксирован, redirects:error. Таким образом actual evidence и рабочая функция выпускаются вместе.

Новых SQL/секретов/покупок/аккаунтов/frontend assets нет; launch154 остаётся. Локально Node22 npmci/check/lint/release1016/1016/full4814/4814/securityscan/privileged/verifyrelease/workerdryrun и nativewatch/scale/KTV прошли. Независимое read-only ревью87/87, P1/P2нет после checkpoint-fix. Тест транспорта реально проверяет700ID/29calls; lifecycle tests восстанавливают Goa внеuploads, сохраняютv5rollback/12hcadence и проверяют metadata failure/unknownwrite/withdrawal. Новый реальный completed-search и productiongrowth подтверждаются после выпуска, не заменяются этими тестами. Воспроизведение на телефоне не проверено.
