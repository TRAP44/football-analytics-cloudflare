// IDs are strings: Telegram custom emoji identifiers exceed JS safe integers.
export function parseTeamEmojiMap(raw) {
  if (typeof raw!=='string' || raw.length>50000) return Object.freeze({});
  let value;
  try { value=JSON.parse(raw); } catch { return Object.freeze({}); }
  if (!value || typeof value!=='object' || Array.isArray(value)) return Object.freeze({});
  const result=Object.create(null);
  for (const [teamId,emojiId] of Object.entries(value).slice(0,500)) {
    if (!/^[1-9]\d{0,9}$/.test(teamId)) continue;
    if (typeof emojiId!=='string' || !/^[1-9]\d{0,19}$/.test(emojiId)) continue;
    result[teamId]=emojiId;
  }
  return Object.freeze(result);
}

export function teamEmojiHtml(teamId,map) {
  const id=typeof teamId==='number' && Number.isSafeInteger(teamId) && teamId>0
    ? String(teamId) : typeof teamId==='string' && /^[1-9]\d{0,9}$/.test(teamId) ? teamId : '';
  const emojiId=id && map && Object.hasOwn(map,id) ? map[id] : '';
  return typeof emojiId==='string' && /^[1-9]\d{0,19}$/.test(emojiId)
    ? `<tg-emoji emoji-id="${emojiId}">⚽</tg-emoji>` : '⚽';
}

export function withoutTeamCustomEmoji(text) {
  return text.replace(/<tg-emoji emoji-id="[1-9]\d{0,19}">⚽<\/tg-emoji>/g,'⚽');
}

export function isTeamEmojiRejected(error) {
  return error?.status===400 && error?.code==='TELEGRAM_REJECTED'
    && /custom[ _-]?emoji|emoji.?id|premium|fragment/i.test(String(error?.message || ''));
}
