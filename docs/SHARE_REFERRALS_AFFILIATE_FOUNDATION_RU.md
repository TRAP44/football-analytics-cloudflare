# MatchRadar — Share, Referrals и Affiliate Foundation

## Scope

Этот слой отвечает за органический share/referral flow MatchRadar внутри Telegram. Он не включает букмекерские партнёрские программы, рекламный кабинет, выплаты партнёрам или собственный финансовый ledger.

## Share flow

Mini App и Telegram-бот переиспользуют существующий fixture deep link. В start_param остаются source, campaign и content, а при наличии безопасно добавляется непрозрачный referral code. Ограничение Telegram start_param в 64 символа проверяется до формирования ссылки; referral token не обрезается частично.

Share-карточка может содержать команды, турнир, время матча, доступный AI signal и confidence. Если AI signal отсутствует, MatchRadar не подставляет искусственный «вердикт» вместо него.

## Referral attribution

Публичный referral parameter никогда не содержит сырой Telegram ID. Код имеет 16 hex-символов и получается из HMAC с серверным секретом. Сопоставление code → referrer регистрируется только server-side в существующем growth_events через уникальный event_key.

Защиты:
- invalid ref отклоняется;
- forged ref без server-side mapping отклоняется;
- self referral отклоняется;
- первый referrer фиксируется idempotently;
- повторное открытие не создаёт повторную attribution;
- share_open/referral_open/referred_first_open имеют dedupe keys;
- referred_payment создаётся только после уже существующей проверки успешного Telegram Stars payment и дедуплицируется по telegram_payment_charge_id.

Во внешних ссылках и growth metadata не публикуется Telegram ID referrer.

## Growth events

Канонические события нового flow:
- share_created;
- share_open;
- referral_open;
- referred_first_open;
- referred_payment.

Исторические share_link_created/share_card_created продолжают учитываться в агрегатах для обратной совместимости, но новый flow пишет share_created.

## Telegram Affiliate Program foundation

Telegram уже предоставляет нативную Affiliate Program для Mini Apps и Telegram Stars. Официальная модель позволяет владельцу Mini App открыть программу, а пользователям/каналам подключаться к ней и получать Telegram-generated referral links; комиссии и Star attribution ведёт Telegram.

Официальные спецификации:
- https://core.telegram.org/api/bots/referrals
- https://core.telegram.org/api/stars
- https://telegram.org/tour/affiliate-programs

Архитектурное решение MatchRadar:
1. Telegram остаётся source of truth для будущих affiliate commissions и payouts.
2. MatchRadar не создаёт финансовый ledger комиссий и не рассчитывает выплаты.
3. Текущая внутренняя referral attribution используется только для продуктовой аналитики и органического growth flow.
4. Будущая интеграция Telegram Affiliate Program должна быть отдельным production decision с adapter-слоем к Telegram methods (например bots.updateStarRefProgram / payments.connectStarRefBot / payments.getConnectedStarRefBots) и отдельным security review.
5. Реальные affiliate payouts в этом PR не включены.
6. 1win и любые другие betting affiliate programmes в рамках этого PR не подключаются.

## Privacy

Referral code непрозрачный и не содержит Telegram ID. Админские агрегаты не возвращают Telegram ID пользователей. Платёжное событие referral attribution хранит только opaque referral code, plan, Stars amount и recurring flag; referrer Telegram ID в metadata не записывается.

## Rollout

Функция не требует новой Supabase migration: она использует уже существующие growth_events.event_key и unique index для idempotency. При недоступном Supabase referral enrichment fail-soft: обычная share-ссылка продолжает работать без referral code.

Affiliate activation, commission settings и любые payouts остаются выключенными до отдельного решения.
