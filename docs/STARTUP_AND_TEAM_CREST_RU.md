# Первый вход и отсутствующие гербы

Манифест и bootstrap-профиль стартуют одновременно. Серверная авторизация профиля сохраняется; favorites/feed по-прежнему ждут compatibility и beta gates. Runtime из манифеста переиспользуется. Identity timing теперь перекрывается с manifest timing, складывать эти интервалы нельзя. Искусственная пауза120мс после готовой ленты удалена. Telegram SDK загружается defer перед module entry: браузер может разбирать страницу и загружать ресурсы, сохраняя SDK перед инициализацией приложения.

Изолированный benchmark actualmain/branch startup functions,3пары: fixedmanifest80мс/profile80мс/feed40мс. Main326/323/324мс, branch125/123/121мс. Это воспроизведение удалённого waterfall и паузы, не production latency/телефон пользователя.

В главной карточке пустые/невалидные URLs и сетевые ошибки изображения заменяются нейтральным щитом с инициалами; реальные загруженные эмблемы сохраняются. Имя выводится textContent/escapedHTML. Не применяется эвристика по цвету/размеру или сегменту URL default: так можно скрыть настоящий герб.

Отдельный случай со скриншота: provider может отдать camera/image-not-available PNG с HTTP200. Phase1 не утверждает, что исправила этот файл. Manual/main-only protected ObserveLiveUsage имеет optional inspect_crest=false. При true скрипт читает только2конкретных public provider-fixtures cache keys (UTCtoday/yesterday, max2MB каждый), выбирает только FARDU, скачивает до2canonical publicPNG (128KB/512px), выводит только publicteamID/URL/SHA256 иPNGartifact. Credentials остаются только на Supabase; нет providerAPI, Telegram, SQLwrite или rawpayloadoutput. Полученный реальный файл нужен для точного fingerprint, чтобы не подменять настоящий логотип догадкой.


## Подтверждённый PNG FARDU

Inspection39240543606: teamID25763, canonicalURL https://media.api-sports.io/football/teams/25763.png, HTTP200,29416байт. Файл просмотрен: camera/image-not-available,150×150. SHA25672f0bbb253ab54961cd5d66148e55aceb3e6bc9823da43e57a6e0812e5427430. Fixture сохранён для regressiontest, эмблема клуба не выдумывается.

Только этот resource получает проверку rawbyteSHA256 (не pixel/color/size heuristic). Пока идёт проверка, показан нейтральный FA; exactmatch/недоступныйресурс сохраняют щит, другой файл разрешает исходныйimg. Сетевойerrorfallback не удаляется поздним ответом; сменившийсяsrc не перезаписывается и не остаётся скрытым. Одна sharedпроверка на минуту при рендерах, 128KB/2.5s, credentialsomit/referrernone/redirecterror. Нет API-Footballquota или блокирования startup.

CSPconnect-src дополнен только уже используемым публичнымimagehost https://media.api-sports.io, чтобы браузер мог прочитать bytes черезCORS. Остальные ограничения неизменны. SHAпроверка не зависит от premultipliedalpha/цветового профиляcanvas разных браузеров. Нормальные неизвестныеURL не проверяются и не фильтруются. Обновлённый файл по тому же адресу не блокируется при другом digest; обычный cachepolicyCDN/браузера остаётся в силе.
