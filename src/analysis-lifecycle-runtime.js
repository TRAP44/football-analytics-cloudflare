import { neutralSignalText } from './signal-wording.js';

// Analysis freshness, kickoff handoff and recheck-delta lifecycle extracted from worker.js.
// Storage and match-status primitives are injected by the composition root.
export function createAnalysisLifecycleRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Analysis lifecycle runtime dependencies are required.');
  }
  const {
    hasSupabase,
    isFinishedStatus,
    isLiveStatus,
    memory,
    supaSelectOne,
  } = deps;

  const requiredFunctions={
    hasSupabase,
    isFinishedStatus,
    isLiveStatus,
    supaSelectOne,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory is required');
  }
  if (!(memory.history instanceof Map)) {
    throw new TypeError('memory.history must be a Map');
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function rows(value, limit = 200) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safeText(value, max = 240) {
    if (!['string','number','bigint'].includes(typeof value)) return '';
    return String(value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number !== null && Number.isSafeInteger(number) && number>0 ? number : null;
  }

  function safeNow(value) {
    const number=finiteNumber(value);
    return number !== null && number>=0 ? number : Date.now();
  }

  function parsedTime(value) {
    const raw=safeText(value,80);
    if (!raw) return null;
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function statusFlag(checker,status) {
    try { return checker(status) === true; }
    catch { return false; }
  }

  function useSupabase(cfg) {
    try { return hasSupabase(cfg) === true; }
    catch { return false; }
  }

  function trustedLineupsConfirmed(payload) {
    const source=objectValue(payload) || {};
    const impact=objectValue(source.lineupImpact);
    if (impact) return impact.homeConfirmed === true && impact.awayConfirmed === true;

    const reliabilityMeta=objectValue(source?.providerReliability?.features?.lineups)
      || objectValue(source?.dataProvenance?.features?.lineups);
    const sourceTrusted=reliabilityMeta?.confidenceBearing === true
      && reliabilityMeta?.stale !== true;
    if (!sourceTrusted) return false;

    const quality=objectValue(source.lineupQuality);
    if (quality && typeof quality.bothConfirmed === 'boolean') {
      return quality.bothConfirmed === true;
    }
    const homeQuality=objectValue(source?.lineups?.home?.quality);
    const awayQuality=objectValue(source?.lineups?.away?.quality);
    return homeQuality?.confirmed === true && awayQuality?.confirmed === true;
  }

  function analysisFreshness(payload = {}, now = Date.now()) {
    const source=objectValue(payload) || {};
    const nowMs=safeNow(now);
    const generatedMs=parsedTime(source.generatedAt);
    const kickoffMs=parsedTime(source?.match?.date);
    const status=safeText(source?.match?.status,32);
    const live=statusFlag(isLiveStatus,status);
    const finished=statusFlag(isFinishedStatus,status);
    const generatedValid=generatedMs !== null && generatedMs <= nowMs+5*60_000;
    const kickoffValid=kickoffMs !== null;
    const ageMinutes=generatedValid
      ? Math.max(0,Math.round((nowMs-generatedMs)/60000))
      : 99999;
    const minutesToKickoff=kickoffMs !== null
      ? Math.round((kickoffMs-nowMs)/60000)
      : null;
    const lineupsConfirmed=trustedLineupsConfirmed(source);
    const market=objectValue(source.market);
    const marketAvailable=Boolean(
      objectValue(market?.odds)
      || objectValue(market?.probabilities),
    );

    const kickoffPassed=kickoffMs !== null && kickoffMs<=nowMs;

    if (live || finished || kickoffPassed) {
      return {
        state:'started',
        label:finished ? 'Матч завершён' : 'Матч уже начался',
        ageMinutes,
        minutesToKickoff,
        maxAgeMinutes:0,
        needsRecheck:false,
        lineupsConfirmed,
        marketAvailable,
        generatedAtValid:generatedValid,
        kickoffAtValid:kickoffValid,
        reasonCode:'match_started',
        reason:'Предматчевый AI больше не обновляется как pre-match: используйте центр матча.',
      };
    }

    let maxAgeMinutes=45;
    if (minutesToKickoff !== null) {
      if (minutesToKickoff<=15) maxAgeMinutes=3;
      else if (minutesToKickoff<=45) maxAgeMinutes=5;
      else if (minutesToKickoff<=120) maxAgeMinutes=10;
      else if (minutesToKickoff<=360) maxAgeMinutes=20;
    }
    if (minutesToKickoff !== null && minutesToKickoff<=90 && !lineupsConfirmed) {
      maxAgeMinutes=Math.min(maxAgeMinutes,5);
    }

    const needsRecheck=!generatedValid || !kickoffValid || ageMinutes>maxAgeMinutes;
    let reasonCode='fresh';
    let reason=`AI обновлён ${ageMinutes} мин. назад; рабочее окно свежести — ${maxAgeMinutes} мин.`;

    if (!generatedValid) {
      reasonCode='generated_time_invalid';
      reason='Время формирования сохранённого AI-снимка не подтверждено; требуется новая проверка.';
    } else if (!kickoffValid) {
      reasonCode='kickoff_time_invalid';
      reason='Время начала матча не подтверждено; динамическую свежесть AI нельзя определить надёжно.';
    } else if (needsRecheck && minutesToKickoff !== null && minutesToKickoff<=90 && !lineupsConfirmed) {
      reasonCode='lineups_window';
      reason='Матч близко: подтверждённые стартовые составы могли появиться после последнего расчёта.';
    } else if (needsRecheck && minutesToKickoff !== null && minutesToKickoff<=30 && marketAvailable) {
      reasonCode='market_window';
      reason='До старта мало времени: рынок и вероятности могли заметно измениться.';
    } else if (needsRecheck) {
      reasonCode='age_window';
      reason=`Последнему AI-разбору ${ageMinutes} мин.; для этого этапа до матча лимит свежести ${maxAgeMinutes} мин.`;
    }

    return {
      state:needsRecheck ? 'recheck' : 'fresh',
      label:needsRecheck ? 'Нужна перепроверка' : 'AI свежий',
      ageMinutes,
      minutesToKickoff,
      maxAgeMinutes,
      needsRecheck,
      lineupsConfirmed,
      marketAvailable,
      generatedAtValid:generatedValid,
      kickoffAtValid:kickoffValid,
      reasonCode,
      reason,
    };
  }

  function analysisKickoffHandoff(payload = {}, now = Date.now()) {
    const source=objectValue(payload) || {};
    const nowMs=safeNow(now);
    const status=safeText(source?.match?.status,32);
    const kickoffMs=parsedTime(source?.match?.date);
    const minutesToKickoff=kickoffMs !== null
      ? Math.round((kickoffMs-nowMs)/60000)
      : null;
    const finished=statusFlag(isFinishedStatus,status);
    const liveByStatus=statusFlag(isLiveStatus,status);
    const liveByClock=!finished && kickoffMs!==null && kickoffMs<=nowMs;

    if (finished) {
      return {
        state:'finished',
        locked:true,
        minutesToKickoff,
        label:'Матч завершён',
        actionLabel:'Открыть итог матча',
        reason:'Предматчевый AI сохранён как архивный снимок. Для результата, событий и статистики используйте центр матча.',
      };
    }
    if (liveByStatus || liveByClock) {
      return {
        state:'live',
        locked:true,
        minutesToKickoff,
        label:'Матч уже идёт',
        actionLabel:'Открыть центр матча',
        reason:'Предматчевый сигнал зафиксирован и больше не обновляется как live-рекомендация. Смотрите счёт, события и статистику в центре матча.',
      };
    }
    if (kickoffMs === null) {
      return {
        state:'unknown',
        locked:true,
        minutesToKickoff:null,
        label:'Время матча не подтверждено',
        actionLabel:'Обновить данные матча',
        reason:'Без подтверждённого времени начала нельзя безопасно определить фазу предматчевого анализа.',
      };
    }
    if (minutesToKickoff<=10) {
      return {
        state:'imminent',
        locked:false,
        minutesToKickoff,
        label:'Финальное окно до старта',
        actionLabel:'Перепроверить перед стартом',
        reason:'До матча осталось мало времени: финально проверьте составы, потери и движение рынка.',
      };
    }
    return {
      state:'prematch',
      locked:false,
      minutesToKickoff,
      label:'Предматчевый режим',
      actionLabel:'',
      reason:'',
    };
  }

  const ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW=Date.parse('2026-09-23T18:00:00Z');
  function analysisKickoffHandoffDrill() {
    const pre=analysisKickoffHandoff(
      {match:{date:'2026-09-23T20:00:00Z',status:'NS'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    const imminent=analysisKickoffHandoff(
      {match:{date:'2026-09-23T18:08:00Z',status:'NS'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    const live=analysisKickoffHandoff(
      {match:{date:'2026-09-23T17:55:00Z',status:'1H'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    const clockStarted=analysisKickoffHandoff(
      {match:{date:'2026-09-23T18:00:00Z',status:'NS'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    const finished=analysisKickoffHandoff(
      {match:{date:'2026-09-23T15:00:00Z',status:'FT'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    const unknown=analysisKickoffHandoff(
      {match:{date:'invalid',status:'NS'}},
      ANALYSIS_KICKOFF_HANDOFF_DRILL_NOW,
    );
    return {
      pass:pre.state==='prematch'
        && !pre.locked
        && imminent.state==='imminent'
        && !imminent.locked
        && live.state==='live'
        && live.locked
        && clockStarted.state==='live'
        && clockStarted.locked
        && finished.state==='finished'
        && finished.locked
        && unknown.state==='unknown'
        && unknown.locked,
      cases:6,
    };
  }

  async function userHasAnalyzedFixture(userId, fixtureId, cfg) {
    const uid=positiveSafeInteger(userId);
    const id=positiveSafeInteger(fixtureId);
    if (!uid || !id) return false;

    if (useSupabase(cfg)) {
      try {
        const row=objectValue(await supaSelectOne(
          cfg,
          'analysis_history',
          {telegram_id:`eq.${uid}`,fixture_id:`eq.${id}`},
        ));
        return positiveSafeInteger(row?.telegram_id)===uid
          && positiveSafeInteger(row?.fixture_id)===id;
      } catch {
        return false;
      }
    }

    return rows(memory.history.get(uid),500).some(
      row=>positiveSafeInteger(row?.fixture_id)===id,
    );
  }

  const ANALYSIS_FRESHNESS_DRILL_NOW=Date.parse('2026-09-23T18:00:00Z');
  function analysisFreshnessDrill() {
    const base={
      match:{date:'2026-09-23T18:30:00Z',status:'NS'},
      market:{odds:{home:2,draw:3,away:4}},
      lineupImpact:{homeConfirmed:false,awayConfirmed:false},
    };
    const stale=analysisFreshness(
      {...base,generatedAt:'2026-09-23T17:52:00Z'},
      ANALYSIS_FRESHNESS_DRILL_NOW,
    );
    const fresh=analysisFreshness(
      {...base,generatedAt:'2026-09-23T17:58:00Z'},
      ANALYSIS_FRESHNESS_DRILL_NOW,
    );
    const far=analysisFreshness(
      {
        ...base,
        match:{date:'2026-09-24T02:00:00Z',status:'NS'},
        generatedAt:'2026-09-23T17:30:00Z',
      },
      ANALYSIS_FRESHNESS_DRILL_NOW,
    );
    const future=analysisFreshness(
      {...base,generatedAt:'2026-09-24T17:58:00Z'},
      ANALYSIS_FRESHNESS_DRILL_NOW,
    );
    return {
      pass:stale.needsRecheck
        && stale.reasonCode==='lineups_window'
        && !fresh.needsRecheck
        && !far.needsRecheck
        && future.needsRecheck
        && future.reasonCode==='generated_time_invalid',
      cases:4,
    };
  }

  function analysisDeltaProbabilityLabel(key = '') {
    const normalized=safeText(key,20).toLowerCase();
    return normalized==='home'
      ? 'П1'
      : normalized==='draw'
        ? 'Н'
        : normalized==='away'
          ? 'П2'
          : normalized;
  }

  function probabilityVector(value) {
    const source=objectValue(value);
    if (!source) return null;
    const home=finiteNumber(source.home);
    const draw=finiteNumber(source.draw);
    const away=finiteNumber(source.away);
    if (
      home === null || draw === null || away === null
      || home<0 || home>100
      || draw<0 || draw>100
      || away<0 || away>100
    ) return null;
    const total=home+draw+away;
    if (!Number.isFinite(total) || Math.abs(total-100)>2.5) return null;
    return {home,draw,away};
  }

  function confirmedLineupSides(payload) {
    const impact=objectValue(objectValue(payload)?.lineupImpact);
    if (!impact) return null;
    return Number(impact.homeConfirmed === true)+Number(impact.awayConfirmed === true);
  }

  function absenceCount(payload) {
    const absences=objectValue(objectValue(payload)?.absences);
    if (!absences || !Array.isArray(absences.home) || !Array.isArray(absences.away)) {
      return null;
    }
    return Math.min(400,absences.home.length+absences.away.length);
  }

  function analysisRecheckDelta(previous = {}, next = {}) {
    const before=objectValue(previous);
    const after=objectValue(next);
    const previousFixtureId=positiveSafeInteger(before?.match?.fixtureId);
    const nextFixtureId=positiveSafeInteger(after?.match?.fixtureId);

    if (!previousFixtureId || !nextFixtureId) {
      return {
        available:false,
        material:false,
        stable:false,
        reasonCode:'fixture_missing',
        codes:[],
        items:[],
        summary:'Нет двух корректных снимков одного матча для сравнения.',
      };
    }
    if (previousFixtureId!==nextFixtureId) {
      return {
        available:false,
        material:false,
        stable:false,
        reasonCode:'fixture_mismatch',
        codes:[],
        items:[],
        summary:'Снимки относятся к разным матчам и не могут сравниваться.',
      };
    }

    const previousGeneratedAt=parsedTime(before?.generatedAt);
    const nextGeneratedAt=parsedTime(after?.generatedAt);
    if (
      previousGeneratedAt !== null
      && nextGeneratedAt !== null
      && nextGeneratedAt < previousGeneratedAt
    ) {
      return {
        available:false,
        material:false,
        stable:false,
        reasonCode:'snapshot_order_invalid',
        codes:[],
        items:[],
        summary:'Новый AI-снимок оказался старше предыдущего; изменение не может считаться корректной перепроверкой.',
      };
    }

    const items=[];
    let incomplete=false;
    const add=(code,title,beforeValue='',afterValue='',importance='medium')=>{
      items.push({
        code:safeText(code,40),
        title:safeText(title,160),
        before:safeText(beforeValue,180),
        after:safeText(afterValue,180),
        importance:['high','medium','low'].includes(importance) ? importance : 'medium',
      });
    };

    const oldSignal=safeText(before?.aiInstructor?.betSignal?.code,40);
    const newSignal=safeText(after?.aiInstructor?.betSignal?.code,40);
    // Нейтральные слова по коду сигнала вместо ставочных меток («ТБ 2.5», «П1»).
    const signalNames={home:before?.match?.home?.name || after?.match?.home?.name,away:before?.match?.away?.name || after?.match?.away?.name};
    const oldSignalLabel=safeText(neutralSignalText(oldSignal,signalNames) || 'AI-разбор',120);
    const newSignalLabel=safeText(neutralSignalText(newSignal,signalNames) || 'AI-разбор',120);
    if (oldSignal && newSignal && oldSignal!==newSignal) {
      add('signal','Вывод AI изменился',oldSignalLabel,newSignalLabel,'high');
    } else if (!oldSignal || !newSignal) {
      incomplete=true;
    }

    const oldProbabilities=probabilityVector(before?.probabilities);
    const newProbabilities=probabilityVector(after?.probabilities);
    if (oldProbabilities && newProbabilities) {
      const probRows=['home','draw','away']
        .map(key=>({
          key,
          delta:Math.round((newProbabilities[key]-oldProbabilities[key])*10)/10,
        }))
        .sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
      const maxProb=probRows[0];
      if (maxProb && Math.abs(maxProb.delta)>=3) {
        add(
          'probability',
          'Вероятности заметно сдвинулись',
          '',
          `${analysisDeltaProbabilityLabel(maxProb.key)} ${maxProb.delta>0?'+':''}${maxProb.delta.toFixed(1)} п.п.`,
          Math.abs(maxProb.delta)>=7 ? 'high' : 'medium',
        );
      }
    } else {
      incomplete=true;
    }

    const oldConf=finiteNumber(before?.aiInstructor?.confidenceScore ?? before?.confidence?.score);
    const newConf=finiteNumber(after?.aiInstructor?.confidenceScore ?? after?.confidence?.score);
    const oldConfValid=oldConf !== null && oldConf>=0 && oldConf<=100;
    const newConfValid=newConf !== null && newConf>=0 && newConf<=100;
    if (oldConfValid && newConfValid && Math.abs(newConf-oldConf)>=8) {
      add(
        'confidence',
        'Уверенность модели изменилась',
        `${Math.round(oldConf)}/100`,
        `${Math.round(newConf)}/100`,
        Math.abs(newConf-oldConf)>=15 ? 'high' : 'medium',
      );
    } else if (!oldConfValid || !newConfValid) {
      incomplete=true;
    }

    const oldLineups=confirmedLineupSides(before);
    const newLineups=confirmedLineupSides(after);
    if (oldLineups !== null && newLineups !== null && oldLineups!==newLineups) {
      if (newLineups>oldLineups) {
        add(
          'lineups',
          'Появились подтверждённые стартовые составы',
          oldLineups===0 ? 'Не подтверждены' : `${oldLineups}/2 подтверждены`,
          newLineups===2 ? 'Оба состава подтверждены' : `${newLineups}/2 подтверждены`,
          'high',
        );
      } else {
        add(
          'lineups',
          'Подтверждение стартовых составов ухудшилось',
          oldLineups===2 ? 'Оба состава подтверждены' : `${oldLineups}/2 подтверждены`,
          newLineups===0 ? 'Не подтверждены' : `${newLineups}/2 подтверждены`,
          'high',
        );
      }
    } else if (oldLineups === null || newLineups === null) {
      incomplete=true;
    }

    const oldAbs=absenceCount(before);
    const newAbs=absenceCount(after);
    if (oldAbs !== null && newAbs !== null && oldAbs!==newAbs) {
      add(
        'absences',
        'Изменились подтверждённые потери',
        oldAbs,
        newAbs,
        Math.abs(newAbs-oldAbs)>=2 ? 'high' : 'medium',
      );
    } else if (oldAbs === null || newAbs === null) {
      incomplete=true;
    }

    const oldMarketSource=objectValue(before?.market);
    const newMarketSource=objectValue(after?.market);
    const oldMarket=probabilityVector(oldMarketSource?.probabilities);
    const newMarket=probabilityVector(newMarketSource?.probabilities);
    if (oldMarket && newMarket) {
      const marketRows=['home','draw','away']
        .map(key=>({
          key,
          delta:Math.round((newMarket[key]-oldMarket[key])*10)/10,
        }))
        .sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
      const maxMarket=marketRows[0];
      if (maxMarket && Math.abs(maxMarket.delta)>=2.5) {
        add(
          'market',
          'Рынок заметно изменился',
          '',
          `${analysisDeltaProbabilityLabel(maxMarket.key)} ${maxMarket.delta>0?'+':''}${maxMarket.delta.toFixed(1)} п.п.`,
          Math.abs(maxMarket.delta)>=5 ? 'high' : 'medium',
        );
      }
    } else if (oldMarket && !newMarketSource) {
      add(
        'market',
        'Рыночный сигнал стал недоступен',
        'Доступен',
        'Недоступен',
        'high',
      );
    } else if (newMarket && !oldMarketSource) {
      add(
        'market',
        'Рыночный сигнал появился',
        'Недоступен',
        'Доступен',
        'high',
      );
    } else if (oldMarketSource || newMarketSource) {
      incomplete=true;
    }

    const oldRef=safeText(before?.match?.referee,180);
    const newRef=safeText(after?.match?.referee,180);
    if (oldRef!==newRef) {
      if (!oldRef && newRef) {
        add('referee','Назначен судья','Не был указан',newRef,'medium');
      } else if (oldRef && newRef) {
        add('referee','Изменено назначение судьи',oldRef,newRef,'medium');
      } else if (oldRef && !newRef) {
        add('referee','Назначение судьи больше не подтверждено',oldRef,'Не указан','medium');
      }
    }

    const codes=[...new Set(items.map(item=>item.code).filter(Boolean))];
    const material=items.some(item=>item.importance==='high')
      || codes.some(code=>['signal','probability','lineups','market'].includes(code));
    const stable=items.length===0 && !incomplete;
    // Изменения рынка (коэффициенты) учитываются в существенности, но пользователю не показываются.
    const visibleItems=items.filter(item=>item.code!=='market');
    const summary=stable
      ? 'Значимых изменений после перепроверки не найдено.'
      : visibleItems.length
        ? material
          ? `После перепроверки есть значимые изменения: ${visibleItems.slice(0,3).map(item=>item.title.toLocaleLowerCase('ru-RU')).join(', ')}.`
          : `Обновились детали матча: ${visibleItems.slice(0,3).map(item=>item.title.toLocaleLowerCase('ru-RU')).join(', ')}.`
        : items.length
          ? 'После перепроверки обновились внешние данные матча; выводы AI не изменились.'
          : 'Часть полей двух снимков не удалось надёжно сопоставить; стабильность прогноза не подтверждена.';

    return {
      available:true,
      material,
      stable,
      incomplete,
      reasonCode:incomplete && !items.length ? 'comparison_incomplete' : '',
      codes,
      items:visibleItems.slice(0,6),
      summary,
    };
  }

  function newsImpactDeltaStatus(
    previous = {},
    next = {},
    delta = null,
    options = {},
  ) {
    const source=objectValue(options) || {};
    const requested=source.requested === true;
    const eligible=source.eligible === true;
    const performed=source.performed === true;
    const publishedAt=safeText(source.publishedAt,80);
    if (!requested) return null;

    const published=publishedAt;
    const previousFixtureId=positiveSafeInteger(objectValue(previous)?.match?.fixtureId);
    const nextFixtureId=positiveSafeInteger(objectValue(next)?.match?.fixtureId);

    if (!previousFixtureId) {
      return {
        requested:true,
        eligible:false,
        performed:false,
        compared:false,
        material:false,
        stable:false,
        publishedAt:published,
        reasonCode:'baseline_missing',
        summary:'До новости не было сохранённого AI-снимка: текущий анализ станет базовой точкой для следующего сравнения.',
        items:[],
        codes:[],
      };
    }
    if (!nextFixtureId || nextFixtureId!==previousFixtureId) {
      return {
        requested:true,
        eligible,
        performed:false,
        compared:false,
        material:false,
        stable:false,
        publishedAt:published,
        reasonCode:'fixture_mismatch',
        summary:'Свежий снимок не относится к тому же матчу, поэтому изменение нельзя связывать с новостью.',
        items:[],
        codes:[],
      };
    }
    if (eligible !== true) {
      return {
        requested:true,
        eligible:false,
        performed:false,
        compared:false,
        material:false,
        stable:false,
        publishedAt:published,
        reasonCode:'snapshot_not_before_news',
        summary:'Сохранённый AI-снимок не старше новости, поэтому приписывать ей изменение прогноза нельзя.',
        items:[],
        codes:[],
      };
    }

    const deltaValue=objectValue(delta);
    if (performed !== true || deltaValue?.available !== true) {
      return {
        requested:true,
        eligible:true,
        performed:false,
        compared:false,
        material:false,
        stable:false,
        publishedAt:published,
        reasonCode:'recheck_unavailable',
        summary:'Новость привязана к матчу, но свежую перепроверку сейчас выполнить не удалось.',
        items:[],
        codes:[],
      };
    }

    const material=deltaValue.material === true;
    const stable=deltaValue.stable === true;
    return {
      requested:true,
      eligible:true,
      performed:true,
      compared:true,
      material,
      stable,
      publishedAt:published,
      reasonCode:material ? 'material_change' : stable ? 'stable' : 'detail_change',
      summary:material
        ? 'После новости и свежей перепроверки обнаружены существенные изменения во входных данных AI.'
        : stable
          ? 'После новости свежая перепроверка не обнаружила значимых изменений в AI-входах.'
          : 'После новости изменились отдельные детали или часть сравнения неполна; существенного сдвига AI-сценария не подтверждено.',
      items:rows(deltaValue.items,6),
      codes:rows(deltaValue.codes,6).map(code=>safeText(code,40)).filter(Boolean),
    };
  }

  function newsImpactDeltaDrill() {
    const previous={match:{fixtureId:71},probabilities:{home:45,draw:30,away:25},market:{probabilities:{home:44,draw:31,away:25}},lineupImpact:{homeConfirmed:false,awayConfirmed:false},absences:{home:[],away:[]},aiInstructor:{betSignal:{code:'skip',label:'Пропустить ставку'},confidenceScore:54}};
    const next={match:{fixtureId:71},probabilities:{home:53,draw:27,away:20},market:{probabilities:{home:50,draw:29,away:21}},lineupImpact:{homeConfirmed:true,awayConfirmed:true},absences:{home:[{name:'X'}],away:[]},aiInstructor:{betSignal:{code:'home',label:'П1'},confidenceScore:68}};
    const delta=analysisRecheckDelta(previous,next);
    const impact=newsImpactDeltaStatus(previous,next,delta,{requested:true,eligible:true,performed:true,publishedAt:'2026-09-23T12:00:00Z'});
    const guarded=newsImpactDeltaStatus(previous,next,null,{requested:true,eligible:false,performed:false,publishedAt:'2026-09-23T12:00:00Z'});
    const malformedOptions=newsImpactDeltaStatus(previous,next,delta,null);
    const coerciveEligible=newsImpactDeltaStatus(previous,{match:{fixtureId:72}},delta,{requested:true,eligible:'false',performed:true,publishedAt:'2026-09-23T12:00:00Z'});
    return {
      pass:impact?.compared===true
        && impact?.material===true
        && impact?.codes?.includes('signal')
        && guarded?.reasonCode==='snapshot_not_before_news'
        && guarded?.compared===false
        && guarded?.stable===false
        && malformedOptions===null
        && coerciveEligible?.eligible===false,
      cases:8,
    };
  }
  
  function analysisDeltaDrill() {
    const previous={match:{fixtureId:7,referee:''},probabilities:{home:44,draw:29,away:27},market:{probabilities:{home:43,draw:30,away:27}},lineupImpact:{homeConfirmed:false,awayConfirmed:false},absences:{home:[],away:[]},aiInstructor:{betSignal:{code:'skip',label:'Пропустить ставку'},confidenceScore:55}};
    const next={match:{fixtureId:7,referee:'A. Ref'},probabilities:{home:53,draw:26,away:21},market:{probabilities:{home:49,draw:28,away:23}},lineupImpact:{homeConfirmed:true,awayConfirmed:true},absences:{home:[{name:'Player'}],away:[]},aiInstructor:{betSignal:{code:'home',label:'П1'},confidenceScore:69}};
    const delta=analysisRecheckDelta(previous,next);
    return {pass:delta.available && delta.material && delta.codes.includes('signal') && delta.codes.includes('probability') && delta.codes.includes('lineups') && delta.codes.includes('market'),count:delta.items.length};
  }
  function analysisResponsePayload(payload = {}, extra = {}) {
    const source=objectValue(payload) || {};
    const additions=objectValue(extra) || {};
    return {
      ...source,
      freshness:analysisFreshness(source),
      kickoffHandoff:analysisKickoffHandoff(source),
      ...additions,
    };
  }

  return Object.freeze({
    analysisFreshness,
    analysisKickoffHandoff,
    analysisKickoffHandoffDrill,
    userHasAnalyzedFixture,
    analysisFreshnessDrill,
    analysisDeltaProbabilityLabel,
    analysisRecheckDelta,
    newsImpactDeltaStatus,
    newsImpactDeltaDrill,
    analysisDeltaDrill,
    analysisResponsePayload,
  });
}
