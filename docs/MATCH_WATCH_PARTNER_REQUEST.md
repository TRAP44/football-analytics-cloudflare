# Draft — OneFootball / licensed broadcast embed enquiry

Not sent. Recipient entrypoint: https://publishers.onefootball.com (Contact us).
Official integration terms: https://promo.onefootball.com/legal/embed-terms-and-conditions/en, sections3.1/3.2.

Subject: Licensed football video / LIVE integration for MatchRadar Telegram Mini App

Hello,

We are building MatchRadar AI, a football match companion inside a Telegram Mini App. It provides scores, statistics, match analysis and links to official viewing services. Our initial audience is in Russia, with Kazakhstan and Belarus also relevant. We are testing with a small audience (up to50concurrent users); we do not claim established large traffic.

We would like to understand your Embed Partner offering and whether it can include licensed full-match LIVE or replays, in addition to highlights, on a Telegram WebView.

Could you confirm:

1. Which competitions and video types can be licensed (particularly Premier League, LaLiga, SerieA, Bundesliga, Ligue1 and UEFA Champions League), and in which territories? Please distinguish full LIVE, replay and highlights rights.
2. Are Telegram Mini Apps on iOS/Android and an app served from Cloudflare Workers supported? What domain approval, referrer/origin, fullscreen, DRM and authentication requirements apply?
3. What agreement, traffic minimums, fees, advertising/revenue-sharing and consent requirements apply? We would not load the player or its tracking scripts before a user chooses to watch.
4. Does the CMS/API provide event/team/competition identifiers, kickoff times, countries, official playback/embed URLs and revocation/expiry information so that we can match videos to the correct fixtures and hide unavailable content?
5. Are subscriptions handled by you, and is there an official external-viewing fallback if in-app playback is unsupported?
6. What are the onboarding process and sandbox/demo requirements?

Please share the current documentation and commercial/contact path for an eligible integration. We are requesting permission and technical information; this enquiry does not assume that we already have a licence or may redistribute streams.

Thank you,
MatchRadar project owner

---

Before sending: owner confirms sender/contact details and approves contacting the partner. No account creation, terms acceptance or payment is authorised by this draft. The sender/contact details have deliberately not been invented.

## Альтернативный запрос в МатчТВ — черновик

Официальная страница контактов: https://matchtv.ru/contacts (HTTP200). Конкретный получатель для лицензирования/партнёрской дистрибуции ещё не подтверждён; не отправлено.

Здравствуйте! Разрабатываем MatchRadar — футбольное мини-приложение в Telegram. Хотим узнать условия официального подключения вашего плеера для разрешённых трансляций.

На странице канала опубликован iframe endpoint `https://video.matchtv.ru/iframe/channel/106`. Просим подтвердить, разрешается ли его использование в стороннем коммерческом Mini App на Cloudflare Workers, нужны ли договор и согласование домена, какие территории и ограничения Telegram iOS/Android действуют.

Отдельно интересует feed/API расписания и идентификаторов конкретных матчей: как отличать доступный бесплатный эфир от платного канала/подписки, учитывать отзыв прав и корректно сопоставлять событие с командами и временем начала. Не предполагаем, что общий эфир канала автоматически является трансляцией любого футбольного матча.

Уточните стоимость/минимальный трафик, рекламные условия, поддержку авторизации и подписки в вашем плеере и официальный fallback на вашу страницу. Готовы сначала проверить разрешённое вами тестовое событие на реальных Telegram iOS/Android.

Это запрос условий, а не утверждение о наличии разрешения. Контакт отправителя и согласие на обращение добавляет владелец проекта.
