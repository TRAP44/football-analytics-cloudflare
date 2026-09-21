# Football Analytics Mini App v6.9.0 — RC17

Telegram Mini App для футбольной аналитики на Cloudflare Workers, Supabase и API-Football.

## RC17: Champion–Challenger Calibration Lifecycle

- постоянный active-профиль калибровки хранится в Supabase;
- challenger проходит два последовательных непересекающихся trusted holdout-окна;
- продвижение сравнивает challenger с текущим champion, а не только с базовыми весами;
- каждый предматчевый snapshot сохраняет fingerprint применённого профиля;
- post-promotion когорта автоматически возвращает предыдущий champion при существенном ухудшении Brier или log loss;
- promotion и rollback пишутся в `ops_events`;
- при отсутствии схемы lifecycle Worker fail-closed и оставляет production на baseline.

## Надёжность

- Telegram `initData` проверяется сервером;
- технические маршруты закрыты admin gate;
- прогнозы сохраняются до начала матча и не перезаписываются;
- метрики используют только `confirmed` и `adjudicated` settlement;
- итог матча подтверждается двумя provider-проверками;
- drift требует явного adjudication;
- runtime controls, settlement circuit breaker и cron audit остаются активны.

## Проверки

```bash
npm ci
npm run check
npm test
npm run verify:release
```

GitHub Actions выполняет эти проверки для каждого Pull Request и push в `main`.

## Установка

См. [INSTALL_RU.md](./INSTALL_RU.md).

Telegram Stars по умолчанию остаются выключены через `MONETIZATION_ENABLED=false`.
