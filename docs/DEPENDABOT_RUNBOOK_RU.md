# Dependabot — MatchRadar

## Цель

Dependabot автоматически проверяет версии зависимостей, но **не выполняет merge** и не деплоит изменения самостоятельно.

Конфигурация находится в:

`.github/dependabot.yml`

## Что проверяется

Раз в неделю, по понедельникам:

- npm dependencies — 06:20 Europe/Riga;
- GitHub Actions — 06:40 Europe/Riga.

Minor и patch обновления группируются, чтобы не создавать десятки отдельных PR.

Major обновления не группируются. Они должны рассматриваться отдельно, потому что могут содержать breaking changes.

## Защита от шума

Для каждого ecosystem установлен лимит максимум 5 открытых Dependabot PR.

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
