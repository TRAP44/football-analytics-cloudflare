# RC55 — Real Launch Drill & Search Quality

## Цель

Перед реальным трафиком из СМИ проверить не только доступность Worker, но и качество первого пользовательского действия: **поиска клуба или матча**.

RC55 не создаёт синтетические production-события и не подменяет фактическую конверсию. Он добавляет deterministic self-test резолвера и безопасную агрегацию реальных исходов поиска.

## Матрица search-quality

Встроенный self-test проверяет формы:

- МЮ / мю!!! → Manchester United;
- ПСЖ? → Paris Saint Germain;
- Барса. → Barcelona;
- Бока-Хуниорс → Boca Juniors;
- Ривер-Плейт → River Plate;
- Al-Nassr → Al-Nassr;
- Fenerbahçe → Fenerbahce;
- Beşiktaş → Besiktas;
- São Paulo → Sao Paulo;
- Bayern München → Bayern Munich;
- Red-Star Belgrade / Crvena Zvezda → FK Crvena Zvezda;
- Интер-Майами → Inter Miami;
- ЛАФК → Los Angeles FC;
- Шахтёр → Shakhtar Donetsk;
- Олимпиакос! → Olympiakos Piraeus;
- Динамо Киев → Dynamo Kyiv.

Self-test не расходует API-Football: он проверяет локальную нормализацию и canonical resolver.

## Разделитель матча

Внутренний дефис клуба не считается разделителем двух команд.

Корректные формы матча:
- `Интер — Милан`;
- `Интер – Милан`;
- `Inter vs Milan`;
- `Интер против Милана`;
- дефис с пробелами: `Интер - Милан`.

Форма `Al-Nassr` остаётся одним клубом.

## Реальные поисковые исходы

После Telegram-поиска пишется отдельное событие `search_result` с одним из исходов:

`match / recognized_no_match / not_found`.

В metadata разрешены только безопасные поля: intent, outcome, recognized и count. Текст запроса, rawText и parts.query не сохраняются.

Админская launch-воронка агрегирует:
- attempts;
- match;
- recognizedNoMatch;
- notFound;
- matchPct.

## UX при деградации провайдера

Если canonical resolver распознал клуб, но источник не вернул календарь, пользователь видит «Клуб распознан» и кнопку «Повторить». Она запускает новый поиск по каноническому названию, не открывая лишний продуктовый экран.

## Production gate

`/health.searchQualitySelfTest` должен быть `enabled`. Post-deploy smoke требует этот флаг вместе с RC55 search-флагами. Если deterministic матрица ломается, production verification завершается ошибкой.

## Ручной launch drill

Перед публикацией в СМИ:
1. новая учётная запись → /start;
2. проверить МЮ, Реал, ПСЖ, Бока-Хуниорс, Al-Nassr, São Paulo, Fenerbahçe;
3. проверить матч «Интер — Милан»;
4. открыть быстрый AI;
5. открыть полный AI конкретного fixture;
6. вернуться через новости;
7. в админке проверить funnel, bottleneck, news return и search quality;
8. убедиться, что not-found не содержит персонального текста пользователя.
