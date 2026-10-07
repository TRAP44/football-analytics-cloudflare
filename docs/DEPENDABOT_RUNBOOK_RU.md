# Dependabot — MatchRadar

## Цель

Dependabot автоматически проверяет версии зависимостей, но **не выполняет merge** и не деплоит изменения самостоятельно.

Конфигурация находится в:

`.github/dependabot.yml`

## Что проверяется

Раз в неделю, по понедельникам:

- npm dependencies — 06:20 Europe/Riga;
- GitHub Actions — 06:40 Europe/Riga.

Minor и patch version updates группируются, чтобы не создавать десятки отдельных PR.

Major version updates не группируются. Они должны рассматриваться отдельно, потому что могут содержать breaking changes.

Группы в `.github/dependabot.yml` явно применяются только к `version-updates`: security update PR не смешиваются с обычными еженедельными обновлениями.

## Защита от шума

Для каждого ecosystem установлен лимит максимум 5 открытых Dependabot **version-update PR**. Security update PR этим параметром не ограничиваются и в этот лимит не входят.

Автоматического merge нет.

Каждый Dependabot PR должен пройти обычный MatchRadar Quality gate:

- npm audit;
- security scan;
- lint;
- syntax/check;
- полный test suite;
- bottom-nav smoke;
- release verification;
- Worker dry-run.

Если обновление затрагивает runtime/production поведение, merge выполняется только после успешных проверок.

## Security updates

Dependabot security alerts и security update PR следует рассматривать отдельно от обычного weekly version update. High/Critical уязвимости имеют приоритет над косметическими version bumps.

## Политика

Не принимать dependency update только потому, что версия новее.

Для каждого PR учитывать:

- changelog/release notes;
- breaking changes;
- Node/Cloudflare compatibility;
- влияние на lockfile;
- результат Quality gate;
- production risk.

Автоматический merge в Dependabot намеренно не используется.
