export function createProfileSummaryModule({
  state,
  elementById,
  safeUrl,
  planLabel,
  dateOnly,
  createElement,
}) {
  if (!state || typeof elementById !== 'function' || typeof safeUrl !== 'function' || typeof planLabel !== 'function' || typeof dateOnly !== 'function' || typeof createElement !== 'function') {
    throw new TypeError('Profile Summary requires state, elementById, safeUrl, planLabel, dateOnly and createElement.');
  }

  const $ = elementById;

  function renderProfileSummary() {
    if (!state.profile) return;
    const source=state.profile;
    const object=value=>value && typeof value==='object' && !Array.isArray(value) ? value : {};
    const user=object(source.user);
    const quota=object(source.quota);
    const stats=object(source.stats);
    const count=value=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : null;
    const displayCount=value=>value===null ? '—' : String(value);
    const favoriteCount=count(stats.favorites) ?? (Array.isArray(state.favorites) ? state.favorites.length : null);
    const favoritePlayerCountValue=count(stats.favoritePlayers) ?? (Array.isArray(state.favoritePlayers) ? state.favoritePlayers.length : null);
    const reminderCount=count(stats.reminders) ?? (Array.isArray(state.reminders) ? state.reminders.length : null);
    const quotaLeft=count(quota.left);
    const quotaLimit=count(quota.limit);
    const quotaUsed=count(quota.used);
    const firstName=typeof user.firstName==='string' ? user.firstName.trim() : '';
    const username=typeof user.username==='string' ? user.username.trim() : '';
    const profileButtonLabel = $('profileBtn')?.querySelector('span');
    if (profileButtonLabel) profileButtonLabel.textContent = 'Профиль';
    else if ($('profileBtn')) $('profileBtn').textContent = 'Профиль';

    const quotaText = $('quotaText');
    if (quotaText) {
      const showQuota = (quotaLeft!==null && quotaLeft<=3) || state.profileStale;
      quotaText.hidden = !showQuota;
      quotaText.textContent = state.profileStale
        ? 'Показаны сохранённые данные профиля'
        : quotaLeft!==null && quotaLimit!==null ? `Осталось анализов: ${quotaLeft} из ${quotaLimit}` : 'Лимит анализов временно недоступен';
    }

    $('profileName').textContent = firstName || 'Пользователь';

    const avatar = $('avatar');
    if (avatar) {
      const photoUrl = safeUrl(typeof user.photoUrl==='string' ? user.photoUrl : '');
      avatar.classList.remove('has-photo');
      avatar.textContent = '⚽';
      if (photoUrl) {
        const img = createElement('img');
        img.src = photoUrl;
        img.alt = firstName ? `Фото профиля ${firstName}` : 'Фото профиля';
        img.loading = 'eager';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        const currentImage=()=>typeof avatar.contains==='function'
          ? avatar.contains(img) : avatar.children?.[0]===img;
        img.addEventListener('load', () => {
          if (currentImage()) avatar.classList.add('has-photo');
        }, { once: true });
        img.addEventListener('error', () => {
          if (!currentImage()) return;
          avatar.classList.remove('has-photo');
          avatar.textContent = '⚽';
        }, { once: true });
        avatar.replaceChildren(img);
      }
    }

    $('profileUsername').textContent = username ? `@${username}` : '';
    $('profilePlan').textContent = planLabel(quota.plan);
    $('profileUsage').textContent = `${displayCount(quotaUsed)} / ${displayCount(quotaLimit)}`;
    $('memberSince').textContent = typeof user.createdAt==='string' && user.createdAt ? `С нами с ${dateOnly(user.createdAt)}` : '';
    $('favoriteCount').textContent = displayCount(favoriteCount);
    const favoritePlayerCount = $('favoritePlayerCount');
    if (favoritePlayerCount) favoritePlayerCount.textContent = displayCount(favoritePlayerCountValue);
    $('reminderCount').textContent = displayCount(reminderCount);
  }

  return Object.freeze({ renderProfileSummary });
}
