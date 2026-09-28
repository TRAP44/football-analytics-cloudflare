# Supabase Backup Runbook — MatchRadar

## Цель

Production-проект Supabase сейчас находится на Free-плане. Для Free-проектов Supabase рекомендует регулярно делать logical export через `supabase db dump` и хранить копию вне Supabase.

В MatchRadar backup выполняется workflow:

`.github/workflows/backup-supabase.yml`

Он **не изменяет production БД**. Workflow только читает PostgreSQL и формирует logical dump.

## Что сохраняется

Каждый успешный запуск формирует:

- `roles.sql` — роли, которые CLI допускает к переносу;
- `schema.sql` — схема БД, функции, политики и другие schema objects;
- `data.sql` — данные;
- `manifest.txt` — project ref, commit SHA, время создания и версия CLI;
- `SHA256SUMS` — контрольные суммы;
- итоговый `.tar.gz` + SHA-256 checksum архива.

Архив сохраняется как **private GitHub Actions artifact**, а не коммитится в Git.

Retention: **30 дней**.

Автоматический запуск: **раз в неделю, воскресенье 02:17 UTC**.

Ручной запуск обязателен **перед каждой production migration**.

## Одноразовая настройка секрета

Workflow требует GitHub Environment secret:

`SUPABASE_DB_URL`

Для GitHub Actions нужно использовать **Supavisor Session pooler**, потому что GitHub Actions работает в IPv4-only окружении, а direct Supabase DB endpoint Free-проекта по умолчанию IPv6.

1. Открыть Supabase Dashboard → проект MatchRadar.
2. Нажать **Connect**.
3. Выбрать **Session pooler**.
4. Использовать строку на порту **5432**.
5. Подставить текущий database password в connection string.
6. В GitHub открыть репозиторий `TRAP44/football-analytics-cloudflare`.
7. Settings → Environments → `production` → Environment secrets.
8. Добавить secret с именем `SUPABASE_DB_URL`.
9. Значение должно выглядеть как session-pooler PostgreSQL URL и содержать пользователя `postgres.nlmvhkjkpgzzlfavaohk`.

Не добавлять этот URL в `.env`, исходный код, issues, PR comments или логи.

## Первый проверочный backup

После добавления секрета:

1. GitHub → Actions → **Backup Supabase**.
2. Нажать **Run workflow** на ветке `main`.
3. Workflow должен завершиться зелёным.
4. В run появится artifact `supabase-production-backup-<run_id>`.
5. Скачать artifact и отдельно проверить SHA-256 checksum архива.
6. Не распаковывать production backup на публичной/общей машине.

## Что проверяет workflow

Перед выгрузкой workflow:

- проверяет наличие `SUPABASE_DB_URL`;
- требует PostgreSQL URL;
- требует Session pooler `.pooler.supabase.com:5432`;
- проверяет project ref MatchRadar;
- использует закреплённую версию Supabase CLI;
- проверяет Docker;
- после dump убеждается, что `roles.sql`, `schema.sql`, `data.sql` не пустые;
- проверяет наличие ключевых объектов MatchRadar в schema dump;
- проверяет, что connection URL не попал в backup-файлы;
- формирует SHA-256 checksums;
- прекращает процесс при любой ошибке.

## Восстановление

Backup **не восстанавливается автоматически**.

При аварии сначала восстановить dump в отдельную тестовую/новую базу и проверить:

- обязательные таблицы;
- RLS;
- функции/RPC;
- row counts ключевых таблиц;
- `auth.users` и связанные auth-данные, если они присутствуют в выбранном dump scope;
- health/schema probes приложения.

Только после проверки принимать отдельное решение о production restore. Restore в production — потенциально разрушительная операция и должен выполняться вручную с отдельным подтверждением.

## Ограничение Supabase Storage

Database backup не восстанавливает сами файлы из Supabase Storage buckets; база хранит только metadata Storage. Если MatchRadar начнёт хранить пользовательские файлы в Supabase Storage, для объектов Storage нужно добавить отдельный backup-контур.

## Политика на текущем этапе

Пока проект небольшой и находится на Free-плане:

- weekly off-site logical backup;
- manual backup перед каждой production migration;
- 30 дней retention в GitHub Actions;
- никаких платных backup add-ons.

Перед публичным запуском с ценными пользовательскими данными пересмотреть переход на Supabase Pro и ежедневные managed backups.
