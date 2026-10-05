export const PLAYER_FOLLOW_NOTIFICATION_CONTRACT = Object.freeze({
  version: 1,
  subject: 'favorite_player',
  subjectKey: 'playerId',
  eventTypes: Object.freeze([
    'player.starting_lineup',
    'player.absence',
    'player.goal',
    'player.substitution',
    'player.card',
  ]),
});

export function publicPlayerFollowNotificationContract() {
  const eventTypes=Object.freeze([...PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes]);
  return Object.freeze({
    version: PLAYER_FOLLOW_NOTIFICATION_CONTRACT.version,
    subject: PLAYER_FOLLOW_NOTIFICATION_CONTRACT.subject,
    subjectKey: PLAYER_FOLLOW_NOTIFICATION_CONTRACT.subjectKey,
    eventTypes,
  });
}

export function isPlayerFollowNotificationEventType(value) {
  return typeof value === 'string'
    && PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes.includes(value);
}
