# Football Analytics Mini App v6.7.2 — RC15 Trusted Metrics Gate & Two-Pass Finality

RC15 усиливает RC13/RC14: первый совпавший provider-check больше не считается окончательной финальностью для model-quality.

## Что нового

- первый finality pass после settlement старше 6 часов: `unverified → verified`;
- второй matching pass выполняется не раньше чем через 24 часа после первого: `verified → confirmed`;
- если score/outcome либо финальный provider status изменился на втором проходе: `verified → drift`;
- только `confirmed` и `adjudicated` settled rows участвуют в model-quality и calibration;
- `unverified`, first-pass `verified`, `drift` и `void` исключаются;
- добавлены `settlement_verification_count` и `settlement_first_verified_at`;
- calibration cache generation изменена, чтобы старый RC14 cache не обходил новый trusted gate;
- UI показывает confirmed / first-pass / pending / adjudicated / drift и отдельный Trusted metrics count.

## Finality lifecycle

`pending → settled/unverified → verified → confirmed`

В любой provider-check возможно `→ drift`, после чего RC14 требует explicit admin adjudication.

## Safety

RC15 не меняет prediction snapshot. Автоматический verifier не принимает provider correction — при расхождении создаётся drift. Изменение stored settlement по-прежнему возможно только через RC14 explicit adjudication.

## Supabase

Перед Deploy выполнить `supabase_migration_v6_7.sql`.

## Health

Ожидается:
- version = `6.7.2-rc15`;
- releaseCandidate = `RC15`;
- trustedMetricsGate = enabled;
- twoPassSettlementFinality = enabled;
- settlementFinalityVerification = enabled;
- settlementAdjudication = enabled;
- monetization = paused.

Telegram Stars остаются paused.


## RC15 hotfix 6.7.1

Исправлено отображение пустого Runtime status banner в Telegram WebView: `runtimeBanner[hidden]` теперь принудительно получает `display:none!important`. Cache-bust обновлён, чтобы клиент забрал новый CSS после Deploy.


## RC15 UI cleanup 6.7.2

Интерфейс и админ-панель приведены к единой русской терминологии. Исправлены устаревшие RC10/v5.0 подписи, динамическая метка RC при запуске, декоративная RC-метка, смешанные статусы Runtime/Release/Settlement и англоязычные названия административных блоков. Рабочие диагностические функции сохранены; удалён только устаревший текст и визуальный шум.
