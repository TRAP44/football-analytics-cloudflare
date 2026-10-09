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

function safeCall(fn,...args) {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function positiveFixtureId(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function confidenceValue(value) {
  return typeof value==='number'
    && Number.isFinite(value)
    && value>=0
    && value<=100
      ? value
      : null;
}

function strictTimestamp(value) {
  if (typeof value!=='string' || !value.trim()) return '';
  const raw=value.trim();
  const dateOnly=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year=Number(dateOnly[1]);
    const month=Number(dateOnly[2]);
    const day=Number(dateOnly[3]);
    if (month<1 || month>12 || day<1) return '';
    const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    return day<=maxDay ? raw : '';
  }
  const timestamp=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!timestamp) return '';
  const year=Number(timestamp[1]);
  const month=Number(timestamp[2]);
  const day=Number(timestamp[3]);
  if (month<1 || month>12 || day<1) return '';
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay || !Number.isFinite(Date.parse(raw))) return '';
  return raw;
}

function normalizeHistoryItem(value) {
  const item=plainObject(value);
  if (!item) return null;
  const fixtureId=positiveFixtureId(safeRead(item,'fixtureId'));
  if (!fixtureId) return null;
  return {
    fixtureId,
    homeName:safeText(safeRead(item,'homeName'),180),
    awayName:safeText(safeRead(item,'awayName'),180),
    homeLogo:safeText(safeRead(item,'homeLogo'),2048),
    awayLogo:safeText(safeRead(item,'awayLogo'),2048),
    leagueName:safeText(safeRead(item,'leagueName'),180),
    fixtureDate:strictTimestamp(safeRead(item,'fixtureDate')),
    viewedAt:strictTimestamp(safeRead(item,'viewedAt')),
    aiSignalLabel:safeText(safeRead(item,'aiSignalLabel'),160),
    aiSignalCode:safeText(safeRead(item,'aiSignalCode'),40),
    aiConfidence:confidenceValue(safeRead(item,'aiConfidence')),
    aiProbabilities:probabilitiesValue(safeRead(item,'aiProbabilities')),
  };
}

function probabilitiesValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const values=['home','draw','away'].map(key=>Number(safeRead(value,key)));
  if (!values.every(item=>Number.isFinite(item) && item>=0 && item<=100)) return null;
  const sum=values.reduce((total,item)=>total+item,0);
  if (sum<98 || sum>102) return null;
  return {home:values[0],draw:values[1],away:values[2]};
}

function normalizedHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen=new Set();
  const out=[];
  for (const raw of value.slice(0,100)) {
    const item=normalizeHistoryItem(raw);
    if (!item || seen.has(item.fixtureId)) continue;
    seen.add(item.fixtureId);
    out.push(item);
    if (out.length>=50) break;
  }
  return out;
}

export function createHistoryRenderer(options={}) {
  const config=plainObject(options) || {};
  const state=plainObject(safeRead(config,'state'));
  const elementById=safeRead(config,'elementById');
  const recoveryCardHtml=safeRead(config,'recoveryCardHtml');
  const escapeHtml=safeRead(config,'escapeHtml');
  const safeUrl=safeRead(config,'safeUrl');
  const dateTime=safeRead(config,'dateTime');
  const relativeAge=safeRead(config,'relativeAge');
  const onReloadHistory=safeRead(config,'onReloadHistory');
  const onOpenSearch=safeRead(config,'onOpenSearch');
  const onOpenHistoryAnalysis=safeRead(config,'onOpenHistoryAnalysis');

  if (!state || typeof elementById!=='function') {
    throw new TypeError(
      'History renderer requires state and elementById.',
    );
  }
  for (const [name,fn] of Object.entries({
    recoveryCardHtml,
    escapeHtml,
    safeUrl,
    dateTime,
    relativeAge,
  })) {
    if (typeof fn!=='function') {
      throw new TypeError(
        `History renderer requires ${name}.`,
      );
    }
  }

  const reloadHistory=typeof onReloadHistory==='function'
    ? onReloadHistory
    : ()=>{};
  const openSearch=typeof onOpenSearch==='function'
    ? onOpenSearch
    : ()=>{};
  const openHistoryAnalysis=
    typeof onOpenHistoryAnalysis==='function'
      ? onOpenHistoryAnalysis
      : ()=>{};

  function element(id) {
    return safeCall(elementById,id) || null;
  }

  function html(value,max=500) {
    const result=safeCall(escapeHtml,safeText(value,max));
    return typeof result==='string' ? result : '';
  }

  function escapedUrl(value) {
    const resolved=safeCall(safeUrl,value);
    if (typeof resolved!=='string' || !resolved) return '';
    try {
      const url=new URL(resolved,'https://history.invalid');
      if (
        !['http:','https:'].includes(url.protocol)
        || url.username
        || url.password
      ) return '';
      return html(url.toString(),2048);
    } catch {
      return '';
    }
  }

  function formattedDate(value) {
    if (!value) return '';
    const result=safeCall(dateTime,value);
    return typeof result==='string' ? safeText(result,120) : '';
  }

  function formattedAge(value) {
    if (!value) return '';
    const result=safeCall(relativeAge,value);
    return typeof result==='string' ? safeText(result,120) : '';
  }

  function addClick(target,handler) {
    const addEventListener=safeRead(target,'addEventListener');
    if (typeof addEventListener!=='function') return;
    safeCall(addEventListener.bind(target),'click',handler);
  }

  function setHtml(target,value) {
    try {
      target.innerHTML=value;
      return true;
    } catch {
      return false;
    }
  }

  function renderHistory() {
    const root=element('history');
    if (!root) return;

    const loading=safeRead(state,'historyLoading')===true;
    const loaded=safeRead(state,'historyLoaded')===true;
    const loadError=safeText(
      safeRead(state,'historyLoadError'),
      280,
    );
    const history=normalizedHistory(safeRead(state,'history'));

    if (loading && !loaded) {
      setHtml(
        root,
        '<div class="loader">Загружаю историю…</div>',
      );
      return;
    }

    if (loadError && !loaded) {
      const recovery=safeCall(recoveryCardHtml,{
        title:'История временно недоступна',
        message:loadError,
        retryId:'historyRecoveryRetry',
      });
      setHtml(
        root,
        typeof recovery==='string'
          ? recovery
          : '<div class="empty">История временно недоступна.</div>',
      );
      addClick(
        element('historyRecoveryRetry'),
        ()=>safeCall(reloadHistory,true),
      );
      return;
    }

    if (!history.length) {
      const retry=loadError
        ? '<button id="historyEmptyRetry" class="secondary-btn" type="button">Обновить историю</button>'
        : '';
      const notice=loadError
        ? `<div class="data-notice stale">⚠️ ${html(loadError)} Последняя загруженная история была пустой.</div>`
        : '';
      setHtml(
        root,
        `${notice}
        <div class="empty history-empty-state">
          <strong>История пока пуста</strong>
          <p>После первого полного анализа матч появится здесь для быстрого повторного открытия.</p>
          <div class="empty-actions">
            ${retry}
            <button id="historyEmptyMatches" class="primary-setting-btn" type="button">Найти матч</button>
          </div>
        </div>`,
      );
      addClick(
        element('historyEmptyRetry'),
        ()=>safeCall(reloadHistory,true),
      );
      addClick(
        element('historyEmptyMatches'),
        ()=>safeCall(openSearch),
      );
      return;
    }

    const notice=loading
      ? '<div class="data-notice">↻ Обновляю историю…</div>'
      : loadError
        ? `<div class="data-notice stale">⚠️ ${html(loadError)} Показана последняя загруженная история.</div>`
        : '';

    const cards=history.map(item=>{
      const homeLogo=escapedUrl(item.homeLogo);
      const awayLogo=escapedUrl(item.awayLogo);
      const fixtureDate=formattedDate(item.fixtureDate);
      const viewedAt=formattedAge(item.viewedAt);
      const confidence=item.aiConfidence===null
        ? ''
        : ` · ${Math.round(item.aiConfidence)}/100`;
      const signal=item.aiSignalLabel
        ? `<em class="history-ai-chip ${item.aiSignalCode==='skip' ? 'skip' : ''}">AI · ${html(item.aiSignalLabel)}${confidence}</em>`
        : '';

      return `
        <article class="history-item">
          <div class="history-logos">
            ${homeLogo ? `<img src="${homeLogo}" alt="">` : ''}
            <span>—</span>
            ${awayLogo ? `<img src="${awayLogo}" alt="">` : ''}
          </div>
          <div class="history-main">
            <strong>${html(item.homeName)} — ${html(item.awayName)}</strong>
            <span>${html(item.leagueName)}${fixtureDate ? ` · ${html(fixtureDate)}` : ''}${viewedAt ? ` · открыто ${html(viewedAt)}` : ''}</span>
            ${signal}
          </div>
          <button class="history-open" data-fixture="${item.fixtureId}" type="button" aria-label="Открыть анализ матча ${html(item.homeName)} — ${html(item.awayName)}">Открыть</button>
        </article>
      `;
    }).join('');

    if (!setHtml(root,notice+cards)) return;

    let buttons=[];
    try {
      const querySelectorAll=safeRead(root,'querySelectorAll');
      if (typeof querySelectorAll==='function') {
        buttons=Array.from(
          querySelectorAll.call(root,'.history-open') || [],
        ).filter(Boolean);
      }
    } catch {}

    for (const btn of buttons) {
      addClick(btn,()=>{
        const dataset=plainObject(safeRead(btn,'dataset')) || {};
        const fixtureId=positiveFixtureId(
          safeRead(dataset,'fixture'),
        );
        if (!fixtureId) return;
        safeCall(openHistoryAnalysis,fixtureId,btn);
      });
    }
  }

  return Object.freeze({renderHistory});
}
