// Keep both teams visible and never cut a UTF-16 surrogate pair in button labels.
export function shortBotLabel(value,limit=20) {
  const label=typeof value==='string' ? value.trim() : '';
  const chars=Array.from(label);
  return chars.length>limit ? chars.slice(0,limit-1).join('').trimEnd()+'…' : label;
}

export function botTeamPairLabel(home,away,limit=20) {
  return `${shortBotLabel(home,limit)} — ${shortBotLabel(away,limit)}`;
}
