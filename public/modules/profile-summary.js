// @ts-check

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
    const { user, quota, stats = {} } = state.profile;
    const profileButtonLabel = $('profileBtn')?.querySelector('span');
    if (profileButtonLabel) profileButtonLabel.textContent = 'Профиль';
    else if ($('profileBtn')) $('profileBtn').textContent = 'Профиль';

    const quotaText = $('quotaText');
    if (quotaText) {
      const showQuota = Number(quota.left) <= 3 || state.profileStale;
      quotaText.hidden = !showQuota;
      quotaText.textContent = state.profileStale
        ? 'Показаны сохранённые данные профиля'
        : `Осталось анализов: ${quota.left} из ${quota.limit}`;
    }

    $('profileName').textContent = user.firstName || 'Пользователь';

    const avatar = $('avatar');
    if (avatar) {
      const photoUrl = safeUrl(user.photoUrl);
      avatar.classList.remove('has-photo');
      avatar.textContent = '⚽';
      if (photoUrl) {
        const img = createElement('img');
        img.src = photoUrl;
        img.alt = user.firstName ? `Фото профиля ${user.firstName}` : 'Фото профиля';
        img.loading = 'eager';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => avatar.classList.add('has-photo'), { once: true });
        img.addEventListener('error', () => {
          avatar.classList.remove('has-photo');
          avatar.textContent = '⚽';
        }, { once: true });
        avatar.replaceChildren(img);
      }
    }

    $('profileUsername').textContent = user.username ? `@${user.username}` : '';
    $('profilePlan').textContent = planLabel(quota.plan);
    $('profileUsage').textContent = `${quota.used} / ${quota.limit}`;
    $('memberSince').textContent = user.createdAt ? `С нами с ${dateOnly(user.createdAt)}` : '';
    $('favoriteCount').textContent = String(stats.favorites ?? state.favorites.length);
    const favoritePlayerCount = $('favoritePlayerCount');
    if (favoritePlayerCount) favoritePlayerCount.textContent = String(stats.favoritePlayers ?? state.favoritePlayers?.length ?? 0);
    $('reminderCount').textContent = String(stats.reminders ?? state.reminders.length);
  }

  return Object.freeze({ renderProfileSummary });
}
