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
- `data.sql` — данные; управляемые Supabase Storage Vector-таблицы `storage.buckets_vectors` и `storage.vector_indexes` исключены по актуальной рекомендации Supabase;
- `manifest.txt` — project ref, commit SHA, время создания и версия CLI;
- `SHA256SUMS` — контрольные суммы внутренних файлов.

Перед загрузкой в GitHub файлы упаковываются в `.tar.gz`, затем архив шифруется **AES-256-CBC + PBKDF2 (250000 iterations)**. Workflow тут же выполняет тестовую расшифровку и сравнение с исходным архивом. Только после успешной проверки открытый архив и временные SQL-файлы удаляются.

В GitHub Actions artifact загружаются только:

- `*.tar.gz.enc`;
- SHA-256 checksum зашифрованного файла.

Архив сохраняется как **private GitHub Actions artifact**, а не коммитится в Git.

Retention: **30 дней**.

Автоматический запуск: **раз в неделю, воскресенье 02:17 UTC**.

Ручной запуск обязателен **перед каждой production migration**.

## Одноразовая настройка секретов

Workflow требует два GitHub Environment secret в environment `production`.

### 1. SUPABASE_DB_URL

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

### 2. BACKUP_ENCRYPTION_PASSPHRASE

Добавить второй Environment secret:

`BACKUP_ENCRYPTION_PASSPHRASE`

Требования:

- минимум 24 символа; рекомендуется длинная случайная фраза;
- хранить отдельно от скачанного backup;
- не добавлять в репозиторий, `.env`, issues, PR comments, сообщения или логи;
- при утрате этой фразы зашифрованные backup-файлы восстановить невозможно.

Workflow маскирует оба секрета в GitHub Actions log.

## Первый проверочный backup

После добавления обоих секретов:

1. GitHub → Actions → **Backup Supabase**.
2. Нажать **Run workflow** на ветке `main`.
3. Workflow должен завершиться зелёным.
4. В run появится artifact `supabase-production-backup-<run_id>`.
5. Artifact должен содержать только `.tar.gz.enc` и его `.sha256`; открытого `.tar.gz` или SQL-файлов там быть не должно.
6. Проверить SHA-256 checksum.
7. Проверить расшифровку на доверенной машине с `BACKUP_ENCRYPTION_PASSPHRASE`.
8. Не распаковывать production backup на публичной/общей машине.

## Что проверяет workflow

Перед выгрузкой workflow:

- проверяет наличие `SUPABASE_DB_URL`;
- проверяет наличие `BACKUP_ENCRYPTION_PASSPHRASE` и минимальную длину 24 символа;
- требует PostgreSQL URL;
- требует Session pooler `.pooler.supabase.com:5432`;
- проверяет project ref MatchRadar;
- использует закреплённую стабильную версию Supabase CLI;
- проверяет Docker и OpenSSL;
- после dump убеждается, что `roles.sql`, `schema.sql`, `data.sql` не пустые;
- проверяет наличие ключевых объектов MatchRadar в schema dump;
- проверяет, что секреты не попали в backup-файлы;
- формирует внутренние SHA-256 checksums;
- шифрует архив;
- проверяет checksum зашифрованного файла;
- выполняет test decrypt + byte-for-byte compare;
- удаляет plaintext до artifact upload;
- прекращает процесс при любой ошибке.

## Расшифровка backup

Пример на доверенной машине:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -in matchradar-supabase-<project>-<timestamp>.tar.gz.enc \
  -out matchradar-supabase-restore.tar.gz \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE
```

После этого проверить SHA-256 внутреннего содержимого и только затем использовать файлы для тестового restore.

## Восстановление

Backup **не восстанавливается автоматически**.

При аварии сначала восстановить dump в отдельную тестовую/новую базу и проверить:

- обязательные таблицы;
- RLS;
- функции/RPC;
- row counts ключевых таблиц;
- auth-данные, если они присутствуют в выбранном dump scope;
- health/schema probes приложения.

Только после проверки принимать отдельное решение о production restore. Restore в production — потенциально разрушительная операция и должен выполняться вручную с отдельным подтверждением.


## Изолированный restore drill

После каждого успешного запуска `Backup Supabase` workflow выполняет второй job — **Isolated restore drill**. Он не подключается к production database на запись и не использует `SUPABASE_DB_URL`.

Порядок проверки:

1. Берётся **ровно тот encrypted artifact**, который создан текущим backup run.
2. Проверяется внешний SHA-256.
3. Архив расшифровывается только во временный каталог GitHub-hosted runner.
4. Проверяются внутренние `SHA256SUMS`, `manifest.txt`, `roles.sql`, `schema.sql` и `data.sql`.
5. Во временном каталоге запускается локальный Supabase stack.
6. `schema.sql` и `data.sql` восстанавливаются в локальную disposable DB.
7. Перед acceptance применяется `scripts/apply-supabase-restore-hardening.sql`: новый/local Supabase target может иметь более широкие default ACL, поэтому restore-процедура явно возвращает `public` к backend-only политике MatchRadar (RLS включён, `anon`/`authenticated` без прямого data access, `service_role` получает только необходимые runtime-права).
8. SQL acceptance проверяет:
   - наличие ключевых таблиц;
   - включённый RLS;
   - отсутствие прямых table privileges у `anon` и `authenticated` на критических таблицах;
   - отсутствие неожиданных write privileges у этих ролей в `public`;
   - доступ `service_role`;
   - ключевые PK/FK constraints;
   - наличие `backend_schema_fingerprint()`.
9. Для `users`, `analysis_cache`, `runtime_controls`, `billing_payments` и `user_entitlements` сравнивается количество строк из `data.sql` и восстановленной БД. Сами production row counts в лог не выводятся.
10. Фиксируются фактические:
   - возраст backup на момент начала drill;
   - время restore + verification;
   - source SHA и workflow run id.
11. Evidence сохраняется отдельным private Actions artifact на 30 дней.
12. Локальный Supabase stack и plaintext restore files удаляются в `always()` cleanup.

Это проверка **disaster-recovery процедуры**, а не production restore. В production backup не восстанавливается автоматически. Любое реальное production-восстановление остаётся отдельной контролируемой операцией после анализа причины инцидента и подтверждения целевой точки восстановления.

### RPO / RTO evidence

- **Observed backup freshness** — фактический возраст конкретного backup в секундах на старте drill.
- **Measured restore time** — фактическое время от старта disposable Supabase restore до завершения schema/data/security verification.
- Weekly schedule задаёт текущий backup cadence; перед рискованными production migrations по-прежнему требуется отдельный fresh backup.
- Эти метрики относятся к техническому восстановлению БД в изолированной среде и не включают DNS, Cloudflare, Telegram или организационное время принятия решения.


## Ограничение Supabase Storage

Database backup не восстанавливает сами файлы из Supabase Storage buckets; база хранит только metadata Storage. Если MatchRadar начнёт хранить пользовательские файлы в Supabase Storage, для объектов Storage нужно добавить отдельный backup-контур.

## Политика на текущем этапе

Пока проект небольшой и находится на Free-плане:

- weekly off-site encrypted logical backup;
- manual backup перед каждой production migration;
- 30 дней retention в GitHub Actions;
- никаких платных backup add-ons.

Перед публичным запуском с ценными пользовательскими данными пересмотреть переход на Supabase Pro и ежедневные managed backups.


### Почему restore включает ACL hardening

Первый фактический drill показал важный DR-риск: production имеет корректный backend-only security contract, но свежий локальный/new-project Supabase target может начинать с более широкими platform default ACL. Поэтому простой replay `schema.sql` + `data.sql` недостаточен как завершённая recovery-процедура.

Обязательный post-restore шаг `scripts/apply-supabase-restore-hardening.sql` повторяет security posture проекта: блокирует прямой доступ `anon`/`authenticated`, включает RLS на public tables, восстанавливает service-role runtime grants и безопасные default privileges. После этого `backend_security_contract()` и `backend_default_acl_contract()` должны возвращать `ok=true`.

Этот шаг применяется только к disposable/new restore target. Production drill не меняет.
