# Football Analytics Mini App v6.8.0 — RC16 Calibration Promotion Gate

RC16 закрывает риск раннего переобучения автоматической калибровки.

## Что изменилось

- adaptive signal weights больше не активируются по той же выборке, на которой были рассчитаны;
- trusted-история делится хронологически на train и более новый holdout;
- кандидат весов должен улучшить Brier минимум на 0.001 и не ухудшить log loss;
- для weight gate требуется минимум 60 trusted матчей и минимум 12 holdout матчей;
- temperature calibration сохраняет отдельную holdout-проверку;
- каждое сформированное holdout-решение записывается в `model_calibration_validations`;
- calibration cache generation = `3.8-promotion1`;
- UI показывает отдельные holdout-выборки и статус promotion gate.

## Безопасность

Если кандидат выглядит лучше на train, но хуже на новых holdout-матчах, он остаётся в тени и production probabilities используют базовые веса.

Trusted rows по-прежнему только `confirmed` и `adjudicated`.

Telegram Stars остаются paused.
