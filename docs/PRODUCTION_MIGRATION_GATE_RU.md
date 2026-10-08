# Проверка миграций production перед деплоем

Релизный контракт задаёт обязательную миграцию в release-contract.json (latestMigration).
В workflow Deploy Production добавлена проверка через Supabase Management API:
GET /v1/projects/{ref}/database/migrations.
Этот запрос только читает историю миграций и ничего не меняет в базе.

## Настройка GitHub (в окружении production или на уровне репозитория)

1. Secret SUPABASE_ACCESS_TOKEN: отдельный Supabase personal access token
   с минимальным разрешением database_migrations_read для рабочего проекта.
   Не использовать SUPABASE_SERVICE_ROLE_KEY или пароль PostgreSQL.
2. Variable SUPABASE_PROJECT_REF: reference рабочего проекта Supabase.
3. После проверки подключения variable SUPABASE_MIGRATION_GATE_REQUIRED=true.

Когда токен и ref заданы, отсутствующая миграция, ошибка API либо некорректный
ответ блокируют деплой до изменения Cloudflare Worker.
Когда оба не заданы и обязательность ещё не включена, CI показывает
NOT ENFORCED. Это НЕ означает, что база проверена. При required=true
отсутствие токена блокирует деплой.

Проверка подтверждает запись в истории Supabase. Она не заменяет
проверку схемы через /health/ready и не гарантирует отсутствия ручных изменений БД.
Документация: https://supabase.com/docs/reference/api/v1-list-migration-history
