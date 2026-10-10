import { localDate, timeOf } from './client-core.js';
import {
  homeMatchScoreLabel,
  matchEvidence as homeMatchEvidence,
  positiveFixtureId as homeFixtureId,
  strictKickoffMs as homeKickoffMs,
} from './home-match-priority.js';

// Главная в стиле SIGNAL: шапка «Читай игру» и карточка «Главный матч».
// Только данные уже загруженной ленты: без новых запросов к API и без
// выдуманных цифр. Если подходящего матча нет — блок скрыт.

const LIVE_PHASES=Object.freeze({
  '1H':'Первый тайм',
  HT:'Перерыв',
  '2H':'Второй тайм',
  ET:'Дополнительное время',
  BT:'Перерыв',
  P:'Серия пенальти',
});

function finiteNumber(value) {
  return typeof value==='number' && Number.isFinite(value) ? value : 0;
}

function list(value) {
  return Array.isArray(value) ? value.slice(0,1000) : [];
}

// Порядок: LIVE → предстоящие → завершённые; внутри — флаг featured,
// интерес, приоритет турнира, затем более раннее начало.
export function selectHomeFeaturedMatch({
  matches,
  excludeFixtureId=0,
  nowMs=Date.now(),
}={}) {
  const excluded=homeFixtureId(excludeFixtureId);
  const now=typeof nowMs==='number' && Number.isFinite(nowMs) ? nowMs : null;
  const rows=[];

  for (const raw of list(matches)) {
    const evidence=homeMatchEvidence(raw);
    if (!evidence || evidence.youthReserve) continue;
    if (excluded && evidence.fixtureId===excluded) continue;

    const kickoffMs=homeKickoffMs(evidence.date);
    let phase;
    if (evidence.live) phase=0;
    else if (evidence.finished) phase=2;
    else if (kickoffMs!==null && now!==null && kickoffMs>=now) phase=1;
    else continue;

    const match=evidence.match;
    const competition=match.competition && typeof match.competition==='object' ? match.competition : null;
    rows.push({
      match,
      phase,
      featured:match.featured===true,
      interest:finiteNumber(match.interestScore),
      priority:finiteNumber(competition?.priority),
      kickoffMs,
    });
  }

  rows.sort((a,b)=>{
    if (a.phase!==b.phase) return a.phase-b.phase;
    if (a.featured!==b.featured) return a.featured ? -1 : 1;
    if (b.interest!==a.interest) return b.interest-a.interest;
    if (b.priority!==a.priority) return b.priority-a.priority;
    const kickoffDelta=(a.kickoffMs ?? Number.POSITIVE_INFINITY)
      -(b.kickoffMs ?? Number.POSITIVE_INFINITY);
    return Number.isFinite(kickoffDelta) ? kickoffDelta : 0;
  });

  return rows[0]?.match || null;
}

// Цифры для шапки: только реально загруженные, валидные, не молодёжные матчи.
export function homeHeroStats(matches) {
  let total=0;
  let live=0;
  for (const raw of list(matches)) {
    const evidence=homeMatchEvidence(raw);
    if (!evidence || evidence.youthReserve) continue;
    total+=1;
    if (evidence.live) live+=1;
  }
  return {total,live};
}

export function russianPlural(count,one,few,many) {
  const n=Math.abs(Number(count) || 0)%100;
  const last=n%10;
  if (n>10 && n<20) return many;
  if (last===1) return one;
  if (last>=2 && last<=4) return few;
  return many;
}

export function createHomeSignalRenderer({
  $,
  state,
  safeUrl,
  escapeHtml,
  analysisHistoryForFixture,
  aiConfidenceMeterHtml,
  openMatchCenter,
  openTeam,
}) {
  function heroDateLabel() {
    const parts=String(localDate(state.offset) || '').split('-').map(Number);
    if (parts.length!==3 || parts.some(n=>!Number.isFinite(n))) return '';
    const day=new Date(parts[0],parts[1]-1,parts[2],12);
    if (!Number.isFinite(day.getTime())) return '';
    const date=day.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    const weekday=day.toLocaleDateString('ru-RU',{weekday:'long'});
    return `${date} · ${weekday}`;
  }

  // Шапка: дата выбранного дня и только реально загруженные цифры.
  function renderHomeHero() {
    const dateEl=$('homeHeroDate');
    if (dateEl) dateEl.textContent=heroDateLabel();
    const statsEl=$('homeHeroStats');
    if (!statsEl) return;
    // Ответ уже применён, если есть matchesMeta: applyMatchPayload() рисует ленту
    // раньше, чем loadMatches() проставит matchesMeta.date, поэтому по дате не
    // сверяемся. При смене дня state.matches очищается и счётчики скрываются.
    const loaded=Boolean(state.matchesMeta) && state.matchesMeta.restrictedDate!==true;
    const stats=homeHeroStats(state.matches);
    statsEl.hidden=!loaded || stats.total<1;
    if (statsEl.hidden) return;
    if ($('homeHeroTotal')) $('homeHeroTotal').textContent=String(stats.total);
    if ($('homeHeroTotalLabel')) $('homeHeroTotalLabel').textContent=`${russianPlural(stats.total,'матч','матча','матчей')} в поле зрения`;
    if ($('homeHeroLive')) $('homeHeroLive').textContent=String(stats.live);
    if ($('homeHeroLiveWrap')) $('homeHeroLiveWrap').hidden=stats.live<1;
  }

  function teamHtml(team,role) {
    const logo=team?.logo
      ? `<img src="${safeUrl(team.logo)}" alt="" loading="lazy" decoding="async">`
      : '<span class="team-logo-fallback" aria-hidden="true">⚽</span>';
    return `<button class="mr-featured-team team-open-link" type="button" data-open-team="${Number(team?.id)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${escapeHtml(team?.logo || '')}">
      <span class="mr-featured-crest">${logo}</span>
      <strong>${escapeHtml(team?.name || '')}</strong>
      <small>${role}</small>
    </button>`;
  }

  // «Главный матч»: не дублирует персональную карточку «Для вас» и никогда
  // не запускает платный AI-разбор сам — только открывает штаб матча.
  function renderHomeFeatured() {
    const root=$('homeFeatured');
    const cardRoot=$('homeFeaturedCard');
    if (!root || !cardRoot) return;
    const personalFixture=Number($('homePersonalMatchBtn')?.dataset.personalFixture || 0);
    const match=selectHomeFeaturedMatch({matches:state.matches,excludeFixtureId:personalFixture});
    root.hidden=!match;
    if (!match) {
      cardRoot.innerHTML='';
      return;
    }

    const fixtureId=Number(match.fixtureId);
    const minute=Number(match.elapsed || 0)>0 ? `${Number(match.elapsed)}′` : '';
    const phase=LIVE_PHASES[String(match.status || '').toUpperCase()] || '';
    const status=match.live
      ? `<b class="mr-featured-status is-live">LIVE${minute ? ` ${minute}` : ''}</b>`
      : match.finished
        ? '<span class="mr-featured-status">Завершён</span>'
        : `<span class="mr-featured-status">${escapeHtml(timeOf(match.date))}</span>`;
    const centre=match.live || match.finished
      ? `<strong>${escapeHtml(homeMatchScoreLabel(match))}</strong><small>${escapeHtml(match.live ? [phase,minute].filter(Boolean).join(' · ') || 'Идёт матч' : 'Итоговый счёт')}</small>`
      : `<strong class="is-time">${escapeHtml(timeOf(match.date))}</strong><small>Начало</small>`;
    const meta=[match.league || 'Турнир',match.roundLabel || ''].filter(Boolean).join(' · ');
    const aiHistory=!match.live && !match.finished ? analysisHistoryForFixture(fixtureId) : null;
    const reason=$('homeFeaturedReason');
    if (reason) reason.textContent=match.live ? 'Идёт сейчас' : match.featured ? 'Матч дня' : match.finished ? 'Итоги дня' : 'Выбор радара';

    cardRoot.innerHTML=`
      <article class="mr-featured-card ${match.live ? 'is-live' : match.finished ? 'is-finished' : 'is-upcoming'}">
        <div class="mr-featured-top">
          <span class="mr-featured-league">${escapeHtml(meta)}</span>
          ${status}
        </div>
        <div class="mr-featured-teams">
          ${teamHtml(match.home,'Хозяева')}
          <div class="mr-featured-score">${centre}</div>
          ${teamHtml(match.away,'Гости')}
        </div>
        ${aiHistory ? aiConfidenceMeterHtml(aiHistory) : ''}
        <button class="mr-featured-open" type="button" data-featured-center="${fixtureId}">Открыть штаб матча <span aria-hidden="true">→</span></button>
      </article>`;
    cardRoot.querySelector('[data-featured-center]')?.addEventListener('click',event=>openMatchCenter(fixtureId,event.currentTarget));
    cardRoot.querySelectorAll('[data-open-team]').forEach(btn=>btn.addEventListener('click',()=>openTeam({
      id:Number(btn.dataset.openTeam),
      name:btn.dataset.teamName || '',
      logo:btn.dataset.teamLogo || '',
    })));
  }

  return Object.freeze({
    render() {
      renderHomeHero();
      renderHomeFeatured();
    },
  });
}
