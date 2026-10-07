function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=280) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCall(fn,...args) {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function safeElements(selectAll,selector) {
  const result=safeCall(selectAll,selector);
  if (!result) return [];
  try {
    return Array.from(result).filter(Boolean);
  } catch {
    return [];
  }
}

function safeElement(elementById,id) {
  return safeCall(elementById,id) || null;
}

function safeHtml(escapeHtml,value) {
  const escaped=safeCall(escapeHtml,safeText(value,500));
  return typeof escaped==='string' ? escaped : '';
}

function safeCard(renderer,row) {
  const html=safeCall(renderer,row);
  return typeof html==='string' ? html : '';
}

function finiteRank(value) {
  return typeof value==='number' && Number.isFinite(value)
    ? value
    : 999;
}

function strictInstantMs(value) {
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const dateOnly=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year=Number(dateOnly[1]);
    const month=Number(dateOnly[2]);
    const day=Number(dateOnly[3]);
    if (month<1 || month>12 || day<1) return null;
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    return day<=maxDay ? Date.UTC(year,month-1,day) : null;
  }
  const timestamp=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!timestamp) return null;
  const year=Number(timestamp[1]);
  const month=Number(timestamp[2]);
  const day=Number(timestamp[3]);
  if (month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchSortTuple(value) {
  const row=plainObject(value) || {};
  const selection=plainObject(safeRead(row,'selection')) || {};
  return {
    rank:finiteRank(safeRead(selection,'rank')),
    date:strictInstantMs(safeText(safeRead(row,'date'),80)),
  };
}

export function createGlobalSearchRenderer(options={}) {
  const config=plainObject(options) || {};
  const state=plainObject(safeRead(config,'state'));
  const globalSearch=plainObject(safeRead(state,'globalSearch'));
  const elementById=safeRead(config,'elementById');
  const querySelectorAll=safeRead(config,'querySelectorAll');
  const escapeHtml=safeRead(config,'escapeHtml');
  const localDiscoveryResults=safeRead(config,'localDiscoveryResults');
  const mergeById=safeRead(config,'mergeById');
  const russianCountLabel=safeRead(config,'russianCountLabel');
  const searchTeamSummaryCard=safeRead(config,'searchTeamSummaryCard');
  const knownTeamSummaryCard=safeRead(config,'knownTeamSummaryCard');
  const searchCompetitionSummaryCard=safeRead(
    config,
    'searchCompetitionSummaryCard',
  );
  const searchMatchCard=safeRead(config,'searchMatchCard');
  const setDiscoveryHomeVisibility=safeRead(
    config,
    'setDiscoveryHomeVisibility',
  );
  const onRenderDiscoveryHome=safeRead(config,'onRenderDiscoveryHome');
  const onRetry=safeRead(config,'onRetry');
  const onBindDiscoveryActions=safeRead(
    config,
    'onBindDiscoveryActions',
  );
  const onBindSearchMatchActions=safeRead(
    config,
    'onBindSearchMatchActions',
  );
  const onSetMode=safeRead(config,'onSetMode');

  if (!state || !globalSearch || typeof elementById!=='function') {
    throw new TypeError(
      'Global search renderer requires state.globalSearch and elementById.',
    );
  }
  for (const [name,fn] of Object.entries({
    escapeHtml,
    localDiscoveryResults,
    mergeById,
    russianCountLabel,
    searchTeamSummaryCard,
    knownTeamSummaryCard,
    searchCompetitionSummaryCard,
    searchMatchCard,
    setDiscoveryHomeVisibility,
  })) {
    if (typeof fn!=='function') {
      throw new TypeError(
        `Global search renderer requires ${name}.`,
      );
    }
  }

  const selectAll=typeof querySelectorAll==='function'
    ? querySelectorAll
    : ()=>[];
  const renderDiscoveryHome=typeof onRenderDiscoveryHome==='function'
    ? onRenderDiscoveryHome
    : ()=>{};
  const retry=typeof onRetry==='function' ? onRetry : ()=>{};
  const bindDiscoveryActions=
    typeof onBindDiscoveryActions==='function'
      ? onBindDiscoveryActions
      : ()=>{};
  const bindSearchMatchActions=
    typeof onBindSearchMatchActions==='function'
      ? onBindSearchMatchActions
      : ()=>{};
  const setMode=typeof onSetMode==='function' ? onSetMode : ()=>{};

  function mergedRows(first,second,idKey) {
    const result=safeCall(
      mergeById,
      safeArray(first),
      safeArray(second),
      idKey,
    );
    return safeArray(result)
      .map(plainObject)
      .filter(Boolean);
  }

  function countLabel(value,one,few,many) {
    const text=safeCall(
      russianCountLabel,
      value,
      one,
      few,
      many,
    );
    return typeof text==='string' ? text : `${value} ${many}`;
  }

  function renderGlobalSearch() {
    const query=safeText(safeRead(globalSearch,'query'),240);
    safeCall(setDiscoveryHomeVisibility,!query);

    const searchButton=safeElement(elementById,'globalSearchBtn');
    if (searchButton) {
      try {
        searchButton.disabled=safeRead(globalSearch,'loading')===true;
        searchButton.textContent=
          safeRead(globalSearch,'loading')===true
            ? 'Ищу…'
            : 'Найти';
      } catch {}
    }

    const wrap=safeElement(elementById,'searchResultsWrap');
    const out=safeElement(elementById,'searchResults');
    const meta=safeElement(elementById,'searchResultsMeta');
    const status=safeElement(elementById,'searchStatus');
    if (!wrap || !out) return;

    const modeValue=safeText(safeRead(globalSearch,'mode'),30);
    const mode=[
      'all',
      'teams',
      'competitions',
      'upcoming',
      'finished',
    ].includes(modeValue)
      ? modeValue
      : 'all';

    for (const btn of safeElements(
      selectAll,
      '[data-search-mode]',
    )) {
      const dataset=plainObject(safeRead(btn,'dataset')) || {};
      const active=safeRead(dataset,'searchMode')===mode;
      const classList=safeRead(btn,'classList');
      const toggle=safeRead(classList,'toggle');
      if (typeof toggle==='function') {
        safeCall(toggle.bind(classList),'active',active);
      }
      const setAttribute=safeRead(btn,'setAttribute');
      if (typeof setAttribute==='function') {
        safeCall(
          setAttribute.bind(btn),
          'aria-pressed',
          active ? 'true' : 'false',
        );
      }
    }

    if (!query) {
      try {
        wrap.hidden=true;
      } catch {}
      try {
        if (status) status.innerHTML='';
      } catch {}
      safeCall(renderDiscoveryHome);
      return;
    }

    const localValue=plainObject(
      safeCall(localDiscoveryResults,query),
    ) || {};
    const localTeams=safeArray(safeRead(localValue,'teams'));
    const localCompetitions=safeArray(
      safeRead(localValue,'competitions'),
    );
    const localMatches=safeArray(safeRead(localValue,'matches'));

    const teams=mergedRows(
      localTeams,
      safeRead(globalSearch,'remoteTeams'),
      'id',
    );
    const knownTeams=safeArray(
      safeRead(globalSearch,'knownTeams'),
    )
      .map(plainObject)
      .filter(Boolean);
    const comps=mergedRows(
      localCompetitions,
      safeRead(globalSearch,'remoteCompetitions'),
      'leagueId',
    );
    const matches=mergedRows(
      safeRead(globalSearch,'remoteMatches'),
      localMatches,
      'fixtureId',
    );

    const upcoming=matches
      .filter(row=>safeRead(row,'finished')!==true)
      .sort((a,b)=>{
        const left=matchSortTuple(a);
        const right=matchSortTuple(b);
        return left.rank-right.rank
          || (left.date ?? Number.POSITIVE_INFINITY)
            -(right.date ?? Number.POSITIVE_INFINITY);
      });
    const finished=matches
      .filter(row=>safeRead(row,'finished')===true)
      .sort((a,b)=>{
        const left=matchSortTuple(a);
        const right=matchSortTuple(b);
        return left.rank-right.rank
          || (right.date ?? Number.NEGATIVE_INFINITY)
            -(left.date ?? Number.NEGATIVE_INFINITY);
      });

    try {
      wrap.hidden=false;
    } catch {}

    if (meta) {
      try {
        meta.textContent=
          countLabel(
            teams.length || knownTeams.length,
            'команда',
            'команды',
            'команд',
          )
          +' · '
          +countLabel(
            comps.length,
            'лига',
            'лиги',
            'лиг',
          )
          +' · '
          +countLabel(
            matches.length,
            'матч',
            'матча',
            'матчей',
          );
      } catch {}
    }

    if (status) {
      const localCount=
        localTeams.length
        +localCompetitions.length
        +localMatches.length;
      const loading=safeRead(globalSearch,'loading')===true;
      const stateValue=safeText(safeRead(globalSearch,'status'),30);
      const stateName=stateValue || (loading ? 'searching' : 'idle');
      const resolvedQuery=safeText(
        safeRead(globalSearch,'resolvedQuery'),
        240,
      );
      const resolved=resolvedQuery
        ? `<small class="search-state-note">Понял запрос: <strong>${safeHtml(escapeHtml,resolvedQuery)}</strong></small>`
        : '';

      let statusHtml='';
      if (loading) {
        statusHtml=localCount
          ? '<div class="search-state is-refreshing"><span>↻</span><div><strong>Обновляем результаты</strong><small>Найденное уже можно открывать.</small></div></div>'
          : '<div class="search-state is-searching"><span>🔎</span><div><strong>Ищем</strong><small>Проверяем доступные матчи и команды.</small></div></div>';
      } else if (stateName==='timeout') {
        statusHtml='<div class="search-state is-warning"><span>⏱</span><div><strong>Источник отвечает слишком долго</strong><small>Показали всё, что уже было доступно. Приложением можно пользоваться дальше.</small></div><button id="searchRetryBtn" class="secondary-btn" type="button">Повторить</button></div>';
      } else if (stateName==='error') {
        const warning=safeText(
          safeRead(globalSearch,'warning'),
          280,
        ) || 'Показаны доступные локальные результаты.';
        statusHtml=`<div class="search-state is-warning"><span>↻</span><div><strong>Не удалось обновить поиск</strong><small>${safeHtml(escapeHtml,warning)}</small></div><button id="searchRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
      } else if (matches.length) {
        const detail=matches.length>1
          ? `Найдено матчей: ${matches.length}`
          : 'Можно открыть карточку или запустить анализ.';
        statusHtml=`<div class="search-state is-success"><span>✓</span><div><strong>Матч найден</strong><small>${detail}</small>${resolved}</div></div>`;
      } else if (teams.length || knownTeams.length || comps.length) {
        statusHtml=`<div class="search-state is-success"><span>✓</span><div><strong>Команда или турнир найден</strong><small>Откройте результат — доступные матчи появятся внутри.</small>${resolved}</div></div>`;
      } else if (
        query.length>=2
        && ['empty','done'].includes(stateName)
      ) {
        statusHtml='<div class="search-state"><span>—</span><div><strong>Матчей сейчас нет</strong><small>Попробуйте другое название или повторите поиск позже.</small></div></div>';
      }

      try {
        status.innerHTML=statusHtml;
      } catch {}

      const retryButton=safeElement(elementById,'searchRetryBtn');
      const addEventListener=safeRead(
        retryButton,
        'addEventListener',
      );
      if (typeof addEventListener==='function') {
        safeCall(
          addEventListener.bind(retryButton),
          'click',
          retry,
        );
      }
    }

    const sections=[];

    if ((mode==='all' || mode==='teams') && teams.length) {
      const cards=teams
        .slice(0,5)
        .map(row=>safeCard(searchTeamSummaryCard,row))
        .filter(Boolean)
        .join('');
      if (cards) {
        sections.push(
          `<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Команда</strong><span>${teams.length}</span></div><div class="search-entity-list">${cards}</div></section>`,
        );
      }
    }

    if (
      (mode==='all' || mode==='teams')
      && !teams.length
      && knownTeams.length
    ) {
      const cards=knownTeams
        .slice(0,5)
        .map(row=>safeCard(knownTeamSummaryCard,row))
        .filter(Boolean)
        .join('');
      if (cards) {
        sections.push(
          `<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Распознано</strong><span>${knownTeams.length}</span></div><div class="search-entity-list">${cards}</div></section>`,
        );
      }
    }

    if (
      (mode==='all' || mode==='competitions')
      && comps.length
    ) {
      const cards=comps
        .slice(0,3)
        .map(row=>safeCard(searchCompetitionSummaryCard,row))
        .filter(Boolean)
        .join('');
      if (cards) {
        sections.push(
          `<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Турнир</strong><span>${comps.length}</span></div><div class="search-entity-list">${cards}</div></section>`,
        );
      }
    }

    if (
      (mode==='all' || mode==='upcoming')
      && upcoming.length
    ) {
      const cards=upcoming
        .slice(0,12)
        .map(row=>safeCard(searchMatchCard,row))
        .filter(Boolean)
        .join('');
      if (cards) {
        sections.push(
          `<section class="panel search-result-block"><div class="mini-section-head"><strong>Предстоящие матчи</strong><span>${upcoming.length}</span></div><div class="search-match-list">${cards}</div></section>`,
        );
      }
    }

    if (
      (mode==='all' || mode==='finished')
      && finished.length
    ) {
      const cards=finished
        .slice(0,12)
        .map(row=>safeCard(searchMatchCard,row))
        .filter(Boolean)
        .join('');
      if (cards) {
        sections.push(
          `<section class="panel search-result-block"><div class="mini-section-head"><strong>Завершённые матчи</strong><span>${finished.length}</span></div><div class="search-match-list">${cards}</div></section>`,
        );
      }
    }

    const emptyHtml=
      '<div class="empty search-empty-state">'
      +'<strong>Ничего не найдено в этом разделе</strong>'
      +'<p>Попробуйте другое название команды или лиги либо переключите фильтр поиска.</p>'
      +'<div class="empty-actions"><button id="searchEmptyAll" class="secondary-btn" type="button">Показать всё</button></div>'
      +'</div>';
    try {
      out.innerHTML=sections.join('')
        || (safeRead(globalSearch,'loading')===true ? '' : emptyHtml);
    } catch {
      return;
    }

    safeCall(bindDiscoveryActions,out);
    safeCall(bindSearchMatchActions,out);

    const emptyButton=safeElement(elementById,'searchEmptyAll');
    const addEventListener=safeRead(emptyButton,'addEventListener');
    if (typeof addEventListener==='function') {
      safeCall(
        addEventListener.bind(emptyButton),
        'click',
        ()=>safeCall(setMode,'all'),
      );
    }
  }

  return Object.freeze({renderGlobalSearch});
}
