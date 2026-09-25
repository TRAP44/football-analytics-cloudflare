# Closed Beta Readiness — FM AI

Статус кода: **READY FOR CLOSED BETA / OPS CHECKS PENDING**  
Базовая версия клиента: **6.120.0-rc144**  
Цель этапа: подготовить существующий продукт к небольшой группе реальных пользователей без добавления новых аналитических функций.

## 1. Критический пользовательский путь

- [x] Telegram Mini App запускается через существующий проверенный handoff-контракт.
- [x] Boot screen имеет recovery-путь и не оставляет пользователя на бесконечной загрузке.
- [x] Поиск показывает локальные результаты сразу и ограничивает ожидание удалённого источника.
- [x] Поиск имеет отдельные состояния: loading / success / empty / timeout / error / retry.
- [x] Список матчей использует snapshot-first загрузку и сохраняет доступные данные при ошибке обновления.
- [x] Пустой список матчей объясняет причину и ведёт пользователя обратно в поиск.
- [x] Открытие матча показывает отдельное loading-состояние.
- [x] Ошибка открытия матча остаётся на понятном recovery-экране с кнопкой «Повторить».
- [x] AI-анализ показывает отдельное loading-состояние при переходе из поиска/матчей.
- [x] Ошибка AI не оставляет пустой экран: показывается recovery-состояние и retry.
- [x] LIVE сохраняет последний успешно загруженный снимок при фоновой ошибке.
- [x] Ошибка фонового LIVE refresh не спамит toast; интерфейс сообщает, что повторит обновление автоматически.
- [x] История имеет loading / empty / error / stale-data состояния и recovery.
- [x] Профиль имеет отдельный loading/error/retry путь, если /api/me временно недоступен.
- [x] Нижняя навигация и Telegram BackButton сохраняют возврат по пользовательскому пути.

## 2. Безопасная продуктовая аналитика beta

Используется существующий endpoint `/api/client-telemetry` и существующая таблица `growth_events`. Новая таблица или сторонний SDK не добавляются.

Фиксируются только allowlisted события:

- `matches_open`
- `search_used`
- `search_found`
- `search_empty`
- `match_open`
- `live_open`
- `ai_start`
- `ai_complete`
- `history_open`
- `history_item_open`
- `profile_open`
- `action_error` с allowlisted action/error category

Privacy contract:

- [x] Не отправляется поисковый запрос пользователя.
- [x] Не отправляются названия команд/турниров.
- [x] Не отправляется текст ошибок как свободный текст.
- [x] Не отправляется содержимое профиля/избранного/истории.
- [x] Сервер повторно валидирует event/action/error/view по allowlist.
- [x] Неизвестные product actions отклоняются.
- [x] События не блокируют пользовательский сценарий при недоступности telemetry endpoint.
- [x] Сохраняется существующая политика retention для growth events.
- [x] Сторонние рекламные/аналитические SDK не добавлены.

## 3. Beta monitoring

Во время закрытой beta ежедневно проверять:

- процент успешных Mini App запусков;
- boot recovery / compatibility block;
- `miniapp_search_used` → `miniapp_search_found`;
- `miniapp_match_open`;
- `miniapp_ai_start` → `miniapp_ai_complete`;
- `miniapp_live_open`;
- `miniapp_history_open`;
- `miniapp_profile_open`;
- `miniapp_error` по action + errorKind;
- provider quota / timeout / rate-limit состояние;
- release monitor и production monitor.

Рекомендуемый критерий остановки beta rollout: повторяемая ошибка критического шага у нескольких пользователей, compatibility block, массовый provider/rate-limit сбой или невозможность завершить AI-путь.

## 4. Blocking before beta

Эти пункты требуют реальной среды/операционного решения и не могут быть честно закрыты только CI:

- [ ] Провести smoke на реальном Telegram минимум с двумя **не-админскими** аккаунтами: открыть Mini App → поиск → матч → AI → история → профиль.
- [ ] Проверить LIVE на реальном идущем матче: первичная загрузка, ручное обновление, один успешный авто-refresh и поведение при временном сетевом сбое.
- [ ] Проверить текущую квоту/тариф футбольного провайдера непосредственно перед приглашением группы и ограничить размер beta-когорты так, чтобы глобальный provider limit не сделал продукт недоступным.
- [ ] Зафиксировать список beta-пользователей и способ обратной связи/поддержки. Для строго технически закрытого доступа нужен отдельный allowlist/gate; текущий этап не вводит новый access-control механизм автоматически.

До выполнения этих пунктов код готов к beta, но rollout реальным пользователям следует считать **OPS-PENDING**.

## 5. Improvements after beta

Не являются блокерами первого закрытого запуска:

- агрегированный admin-виджет конверсии по beta-пути;
- latency percentiles по search / match / AI / LIVE;
- сегментация по cohort/build без персональных данных;
- встроенная кнопка «Сообщить о проблеме»;
- автоматические beta alerts по росту action_error;
- улучшение пустых экранов на основании реальных beta-паттернов;
- отдельный серверный invite allowlist, если beta должна оставаться технически закрытой после расширения аудитории.

## 6. Release gate

Перед merge/deploy должны пройти:

- [ ] `npm ci`
- [ ] `npm audit --audit-level=high`
- [ ] `npm run security:scan`
- [ ] `npm run lint`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run verify:release`
- [ ] `npm run verify:worker`
- [ ] post-merge Quality на `main`
- [ ] production deploy SHA/provenance guard
- [ ] active release identity verification
- [ ] production smoke
