export function createModelEvaluationRuntime(deps = {}) {
  const {
    MODEL_BASE_WEIGHTS,
    actualOutcomeFromGoals,
    brierFromProbabilities,
    clamp,
    getCache,
    hasSupabase,
    json,
    logLossFromProbabilities,
    memory,
    modelQualityEligibleRow,
    parseJsonObject,
    predictedOutcomeForProbabilities,
    predictionOutcomeLabel,
    redactOpsString,
    regulationScore,
    setCache,
    signalDisplayName,
    supaSelectMany,
    supaSelectOne,
    topProbabilityValue,
    validThreeProbabilities,
    verifiedBrierScore,
    verifiedSettledRows
  } = deps;

  async function loadModelPredictionForFixture(fixtureId, cfg) {
    const id=Number(fixtureId || 0);
    if (!id) return null;
    if (hasSupabase(cfg)) {
      try { return await supaSelectOne(cfg,'model_predictions',{fixture_id:`eq.${id}`}); }
      catch (error) { console.warn('post-match prediction read skipped',error?.message || error); return null; }
    }
    return memory.modelPredictions.get(id) || null;
  }
  
  function postMatchOutcomeLabel(value = '') {
    const key=String(value || '');
    return key==='home'?'П1':key==='draw'?'Н':key==='away'?'П2':'—';
  }
  
  function postMatchPredictionProbability(row = {}, outcome = '') {
    const key=String(outcome || '');
    const value=key==='home'?row.home_prob:key==='draw'?row.draw_prob:key==='away'?row.away_prob:null;
    return Number.isFinite(Number(value)) ? Math.round(Number(value)*10)/10 : null;
  }
  
  function postMatchStatValue(statistics = {}, key = '', side = 'home') {
    const item=(statistics?.items || []).find(x=>String(x?.key || '')===String(key));
    if (!item) return null;
    const raw=item?.[side];
    if (raw===null || raw===undefined || raw==='') return null;
    const n=Number(String(raw).replaceAll('%','').replace(',','.'));
    return Number.isFinite(n) ? n : null;
  }
  
  function postMatchFiniteValue(value) {
    if (value===null || value===undefined || value==='') return null;
    if (typeof value!=='number' && typeof value!=='string') return null;
    const num=Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function postMatchResultGoal(value) {
    const n=postMatchFiniteValue(value);
    return Number.isSafeInteger(n) && n>=0 ? n : null;
  }

  function buildPostMatchReview({prediction,fixture,statistics,events,homeName='',awayName=''}) {
    if (!prediction?.fixture_id) {
      return {available:false,state:'no_snapshot',headline:'Нет сохранённого предматчевого снимка',summary:'Этот матч можно изучить по фактической статистике, но честно сравнить его с AI-прогнозом нельзя: до старта снимок модели не был сохранён.',evidence:[],markets:[],calibration:{included:false}};
    }
    const fallbackHome=postMatchResultGoal(prediction.actual_home_goals);
    const fallbackAway=postMatchResultGoal(prediction.actual_away_goals);
    const score=regulationScore(fixture) || (
      fallbackHome!==null && fallbackAway!==null
        ? {home:fallbackHome,away:fallbackAway}
        : null
    );
    const actualOutcome=String(prediction.actual_outcome || (score ? actualOutcomeFromGoals(score.home,score.away) : ''));
    if (!score || !actualOutcome) {
      return {available:false,state:'awaiting_result',headline:'Жду финальный результат',summary:'Предматчевый снимок сохранён, но итог матча ещё не подтверждён для сравнения.',evidence:[],markets:[],calibration:{included:false}};
    }
  
    const predictedOutcome=String(prediction.predicted_outcome || '');
    const predictedProbability=postMatchPredictionProbability(prediction,predictedOutcome);
    const outcomeCorrect=predictedOutcome===actualOutcome;
    const settled=String(prediction.status || '')==='settled';
    const totalGoals=Number(score.home)+Number(score.away);
    const overActual=prediction.over25_actual===null || prediction.over25_actual===undefined ? totalGoals>=3 : Boolean(prediction.over25_actual);
    const bttsActual=prediction.btts_actual===null || prediction.btts_actual===undefined ? Number(score.home)>0 && Number(score.away)>0 : Boolean(prediction.btts_actual);
    const markets=[];
  
    if (postMatchFiniteValue(prediction.over25_prob)!==null) {
      const overPred=Number(prediction.over25_prob)>=50;
      markets.push({code:'over25',label:'Тотал 2.5',predicted:overPred?'ТБ 2.5':'ТМ 2.5',probability:Math.round(Number(prediction.over25_prob)*10)/10,actual:overActual?'ТБ 2.5':'ТМ 2.5',correct:overPred===overActual});
    }
    if (postMatchFiniteValue(prediction.btts_prob)!==null) {
      const bttsPred=Number(prediction.btts_prob)>=50;
      markets.push({code:'btts',label:'Обе забьют',predicted:bttsPred?'Да':'Нет',probability:Math.round(Number(prediction.btts_prob)*10)/10,actual:bttsActual?'Да':'Нет',correct:bttsPred===bttsActual});
    }
  
    const evidence=[];
    const add=(code,icon,title,text,importance='medium')=>evidence.push({code,icon,title,text,importance});
    const hred=postMatchStatValue(statistics,'Red Cards','home') || 0;
    const ared=postMatchStatValue(statistics,'Red Cards','away') || 0;
    const redEvents=(events || []).filter(x=>String(x?.detail || '').toLowerCase().includes('red') || String(x?.label || '').includes('🟥'));
    if (hred+ared>0 || redEvents.length) {
      const redSide=hred>ared?homeName:ared>hred?awayName:(redEvents[0]?.teamName || 'одной из команд');
      add('red_card','🟥','Удаление в матче',`У ${redSide || 'одной из команд'} была красная карточка. Такое событие могло заметно изменить игровой сценарий.`,'high');
    }
  
    const hxg=postMatchStatValue(statistics,'expected_goals','home');
    const axg=postMatchStatValue(statistics,'expected_goals','away');
    if (hxg!==null && axg!==null && Math.abs(hxg-axg)>=0.45) {
      const side=hxg>axg?(homeName || 'Хозяева'):(awayName || 'Гости');
      add('xg','📈','Разница по xG',`${side} создал больше качества моментов по доступному xG: ${hxg.toFixed(2)} — ${axg.toFixed(2)}.`,Math.abs(hxg-axg)>=1?'high':'medium');
    }
  
    const hso=postMatchStatValue(statistics,'Shots on Goal','home');
    const aso=postMatchStatValue(statistics,'Shots on Goal','away');
    if (hso!==null && aso!==null && Math.abs(hso-aso)>=2) {
      const side=hso>aso?(homeName || 'Хозяева'):(awayName || 'Гости');
      add('shots_on_goal','🎯','Удары в створ',`${side} имел заметный перевес по ударам в створ: ${hso} — ${aso}.`,'medium');
    }
  
    const earlyGoal=(events || []).find(x=>String(x?.type || '').toLowerCase()==='goal' && Number(x?.minute || 0)>0 && Number(x.minute)<=20);
    if (earlyGoal) add('early_goal','⚽','Ранний гол',`Гол на ${Number(earlyGoal.minute)}-й минуте мог изменить исходный план команд и дальнейший рисунок игры.`,'medium');
  
    const hpos=postMatchStatValue(statistics,'Ball Possession','home');
    const apos=postMatchStatValue(statistics,'Ball Possession','away');
    if (hpos!==null && apos!==null && Math.abs(hpos-apos)>=15) {
      const side=hpos>apos?(homeName || 'Хозяева'):(awayName || 'Гости');
      add('possession','🧭','Контроль мяча',`${side} заметно больше контролировал мяч: ${Math.round(hpos)}% — ${Math.round(apos)}%.`,'low');
    }
  
    if (!evidence.length) add('scoreline','📌','Итоговый счёт',`Матч завершился ${score.home}:${score.away}. Детальных событий или статистики недостаточно для более глубокого объяснения.`,'low');
  
    const predictedLabel=postMatchOutcomeLabel(predictedOutcome);
    const actualLabel=postMatchOutcomeLabel(actualOutcome);
    const summary=`До матча максимальная вероятность была у ${predictedLabel}${predictedProbability===null?'':` — ${predictedProbability}%`}. Факт: ${actualLabel}, счёт ${score.home}:${score.away}.`;
    const brier=postMatchFiniteValue(prediction.brier_score)===null ? null : Math.round(Number(prediction.brier_score)*1000)/1000;
    return {
      available:true,
      state:'reviewed',
      headline:outcomeCorrect?'Главный исход совпал':'Главный исход не совпал',
      summary,
      score:{home:Number(score.home),away:Number(score.away)},
      outcome:{predicted:predictedOutcome,predictedLabel,probability:predictedProbability,actual:actualOutcome,actualLabel,correct:outcomeCorrect},
      markets,
      evidence:evidence.slice(0,3),
      quality:{
        brier,
        confidence:postMatchFiniteValue(prediction.confidence_score)===null?null:Math.round(Number(prediction.confidence_score)),
        completeness:Number(prediction.completeness_max || 0)>0?Math.round(Number(prediction.completeness_score || 0)/Number(prediction.completeness_max)*100):null,
        calibrationMode:String(prediction.calibration_mode || 'baseline'),
      },
      calibration:{
        included:settled,
        verificationState:String(prediction.settlement_verification_state || ''),
        note:settled
          ? 'Результат сохранён в журнале калибровки. Один матч не перенастраивает модель — изменения принимаются только по накопленной выборке.'
          : 'Предматчевый снимок сохранён, но settlement ещё не завершён.',
      },
      disclaimer:'Факторы ниже описывают наблюдаемую статистику и события матча; они не доказывают причинность результата.',
    };
  }
  
  function postMatchReviewDrill() {
    const prediction={fixture_id:7,status:'settled',predicted_outcome:'home',home_prob:56,draw_prob:25,away_prob:19,actual_home_goals:2,actual_away_goals:1,actual_outcome:'home',brier_score:0.11,over25_prob:62,over25_actual:true,btts_prob:55,btts_actual:true,confidence_score:71,completeness_score:8,completeness_max:10};
    const fixture={fixture:{id:7,status:{short:'FT'}},goals:{home:2,away:1},score:{fulltime:{home:2,away:1}}};
    const statistics={items:[{key:'expected_goals',home:1.9,away:0.8},{key:'Shots on Goal',home:6,away:2}]};
    const review=buildPostMatchReview({prediction,fixture,statistics,events:[{type:'Goal',minute:12}],homeName:'Home',awayName:'Away'});
    return {pass:review.available && review.outcome.correct===true && review.markets.length===2 && review.markets.every(x=>x.correct===true) && review.evidence.some(x=>x.code==='xg'),cases:4};
  }
  
  function average(values) {
    const rows = (values || []).map(Number).filter(Number.isFinite);
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
  }
  
  function pct(part, total) {
    return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
  }
  
  function qualityBucket(rows, label) {
    const valid = (rows || []).filter(x => typeof x.correct === 'boolean');
    return {
      label,
      sample: valid.length,
      accuracy: pct(valid.filter(x => x.correct).length, valid.length),
      avgBrier: valid.length ? Math.round((average(valid.map(verifiedBrierScore).filter(Number.isFinite)) || 0) * 1000) / 1000 : null,
    };
  }
  
  
  function dashboardRound(value, digits = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(n * factor) / factor;
  }
  
  function dashboardLogLoss(row) {
    const key = String(row?.actual_outcome || '');
    if (!['home','draw','away'].includes(key)) return null;
    const p = Math.max(0.01, Math.min(0.99, Number(row?.[`${key}_prob`] || 0) / 100));
    return -Math.log(p);
  }
  
  function dashboardCompletenessPercent(row) {
    const score = Number(row?.completeness_score || 0);
    const max = Number(row?.completeness_max || 0);
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
    return clamp(score / max * 100, 0, 100);
  }
  
  function dashboardBucket(rows, label, extra = {}) {
    const valid = (rows || []).filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')));
    const hitCount = valid.filter(row => row.correct === true).length;
    const top = average(valid.map(topProbabilityValue));
    const acc = pct(hitCount, valid.length);
    const brier = average(valid.map(verifiedBrierScore).filter(Number.isFinite));
    const logLoss = average(valid.map(dashboardLogLoss).filter(Number.isFinite));
    const confidence = average(valid.map(row => Number(row?.confidence_score)).filter(Number.isFinite));
    const completeness = average(valid.map(dashboardCompletenessPercent).filter(Number.isFinite));
    return {
      label,
      sample: valid.length,
      accuracy: acc,
      avgBrier: dashboardRound(brier),
      avgLogLoss: dashboardRound(logLoss),
      avgTopProbability: dashboardRound(top, 1),
      calibrationGap: Number.isFinite(Number(top)) && Number.isFinite(Number(acc)) ? dashboardRound(Number(top) - Number(acc), 1) : null,
      avgConfidence: dashboardRound(confidence, 1),
      avgCompleteness: dashboardRound(completeness, 1),
      ...extra,
    };
  }
  
  function dashboardWeekKey(value) {
    const d = new Date(value || 0);
    if (!Number.isFinite(d.getTime())) return '';
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    d.setUTCHours(0,0,0,0);
    return d.toISOString().slice(0,10);
  }
  
  function dashboardWeekLabel(key) {
    const d = new Date(`${key}T00:00:00.000Z`);
    if (!Number.isFinite(d.getTime())) return key;
    return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  }
  
  function buildWeeklyDashboard(rows, limit = 10) {
    const groups = new Map();
    for (const row of rows || []) {
      const key = dashboardWeekKey(row?.kickoff_at);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()]
      .sort((a,b) => a[0].localeCompare(b[0]))
      .slice(-limit)
      .map(([key, group]) => dashboardBucket(group, dashboardWeekLabel(key), { key }));
  }
  
  function buildLeagueDashboard(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const id = Number(row?.league_id || 0);
      const name = String(row?.league_name || '').trim() || 'Неизвестный турнир';
      const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { id: id || null, name, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()]
      .map(group => dashboardBucket(group.rows, group.name, { leagueId: group.id, leagueName: group.name }))
      .sort((a,b) => Number(b.sample || 0) - Number(a.sample || 0) || String(a.leagueName).localeCompare(String(b.leagueName)))
      .slice(0, 12);
  }
  
  function buildConfidenceDashboard(rows) {
    const defs = [
      ['<50', -Infinity, 50],
      ['50–59', 50, 60],
      ['60–69', 60, 70],
      ['70–79', 70, 80],
      ['80+', 80, Infinity],
    ];
    return defs.map(([label,min,max]) => dashboardBucket(
      (rows || []).filter(row => {
        const v = Number(row?.confidence_score);
        return Number.isFinite(v) && v >= min && v < max;
      }),
      label
    ));
  }
  
  function buildCompletenessDashboard(rows) {
    const defs = [
      ['<60%', -Infinity, 60],
      ['60–79%', 60, 80],
      ['80%+', 80, Infinity],
    ];
    return defs.map(([label,min,max]) => dashboardBucket(
      (rows || []).filter(row => {
        const v = dashboardCompletenessPercent(row);
        return Number.isFinite(v) && v >= min && v < max;
      }),
      label
    ));
  }
  
  function buildCalibrationModeDashboard(rows) {
    const defs = [
      ['baseline', 'База'],
      ['shadow', 'Тень'],
      ['active', 'Активен'],
    ];
    return defs.map(([mode,label]) => dashboardBucket(
      (rows || []).filter(row => String(row?.calibration_mode || 'baseline') === mode),
      label,
      { mode }
    )).filter(x => x.sample > 0);
  }
  
  function buildSignalDashboard(rows) {
    const names = Object.keys(MODEL_BASE_WEIGHTS);
    return names.map(name => {
      const subset = [];
      const signalBriers = [];
      const signalLosses = [];
      let signalHits = 0;
      for (const row of rows || []) {
        if (!['home','draw','away'].includes(String(row?.actual_outcome || ''))) continue;
        const signalMap = parseJsonObject(row?.signal_probabilities);
        const probabilities = signalMap?.[name];
        if (!validThreeProbabilities(probabilities)) continue;
        subset.push(row);
        const sb = brierFromProbabilities(probabilities, row.actual_outcome);
        const sl = logLossFromProbabilities(probabilities, row.actual_outcome);
        if (Number.isFinite(sb)) signalBriers.push(sb);
        if (Number.isFinite(sl)) signalLosses.push(sl);
        if (predictedOutcomeForProbabilities(probabilities) === row.actual_outcome) signalHits++;
      }
      const finalBrier = average(subset.map(verifiedBrierScore).filter(Number.isFinite));
      const finalAccuracy = pct(subset.filter(row => row.correct === true).length, subset.length);
      const signalBrier = average(signalBriers);
      const signalAccuracy = pct(signalHits, subset.length);
      return {
        name,
        label: signalDisplayName(name),
        sample: subset.length,
        signalAccuracy,
        finalAccuracy,
        signalBrier: dashboardRound(signalBrier),
        finalBrier: dashboardRound(finalBrier),
        brierDeltaVsBlend: Number.isFinite(Number(signalBrier)) && Number.isFinite(Number(finalBrier))
          ? dashboardRound(Number(signalBrier) - Number(finalBrier))
          : null,
        signalLogLoss: dashboardRound(average(signalLosses)),
        baseWeight: dashboardRound(Number(MODEL_BASE_WEIGHTS[name] || 0) * 100, 1),
      };
    });
  }
  
  function buildOutcomeDashboard(rows) {
    return ['home','draw','away'].map(key => dashboardBucket(
      (rows || []).filter(row => String(row?.predicted_outcome || '') === key),
      key === 'home' ? 'П1' : key === 'draw' ? 'X' : 'П2',
      { key }
    ));
  }
  
  function buildModelDashboardObservations(rows, dashboard) {
    const notes = [];
    const overall = dashboard?.overview || {};
    const sample = Number(overall.sample || 0);
  
    if (sample < 30) {
      notes.push({
        level: 'info',
        title: 'Выборка ещё небольшая',
        text: `В периоде ${sample} завершённых прогнозов. Разрезы по лигам и уверенности пока нужно читать как диагностику, а не как устойчивые закономерности.`,
      });
    }
  
    if (sample >= 20 && Number.isFinite(Number(overall.calibrationGap)) && Number(overall.calibrationGap) >= 8) {
      notes.push({
        level: 'warn',
        title: 'Модель выглядит переуверенной',
        text: `Средняя максимальная вероятность выше фактической точности примерно на ${Number(overall.calibrationGap).toFixed(1)} п.п. Калибровку стоит продолжать проверять на новых матчах.`,
      });
    }
  
    const high = (dashboard?.confidence || []).find(x => x.label === '80+');
    const mid = (dashboard?.confidence || []).find(x => x.label === '60–69');
    if (Number(high?.sample || 0) >= 12 && Number(mid?.sample || 0) >= 12 &&
        Number.isFinite(Number(high?.accuracy)) && Number.isFinite(Number(mid?.accuracy)) &&
        Number(high.accuracy) <= Number(mid.accuracy)) {
      notes.push({
        level: 'warn',
        title: 'Высокая уверенность пока не даёт прироста',
        text: `В диапазоне 80+ точность ${Number(high.accuracy).toFixed(1)}%, а в 60–69 — ${Number(mid.accuracy).toFixed(1)}%. Это повод проверить причины, но не менять пороги автоматически.`,
      });
    }
  
    const weakLeague = (dashboard?.leagues || []).find(x =>
      Number(x.sample || 0) >= 10 &&
      Number.isFinite(Number(x.avgBrier)) &&
      Number.isFinite(Number(overall.avgBrier)) &&
      Number(x.avgBrier) >= Number(overall.avgBrier) + 0.035
    );
    if (weakLeague) {
      notes.push({
        level: 'watch',
        title: 'Есть лига для дополнительной проверки',
        text: `${weakLeague.leagueName}: n=${weakLeague.sample}, ошибка Брайера ${Number(weakLeague.avgBrier).toFixed(3)} против общего значения ${Number(overall.avgBrier).toFixed(3)}. Возможна специфика турнира или просто шум выборки.`,
      });
    }
  
    const weakSignal = (dashboard?.signals || []).find(x =>
      Number(x.sample || 0) >= 30 &&
      Number.isFinite(Number(x.brierDeltaVsBlend)) &&
      Number(x.brierDeltaVsBlend) >= 0.025
    );
    if (weakSignal) {
      notes.push({
        level: 'watch',
        title: 'Один источник слабее итогового объединённого прогноза',
        text: `${weakSignal.label}: собственная ошибка Брайера ${Number(weakSignal.signalBrier).toFixed(3)}, итоговый прогноз на тех же матчах ${Number(weakSignal.finalBrier).toFixed(3)}. Текущий вес уже ограничен защитными правилами.`,
      });
    }
  
    const latest = (dashboard?.trend || []).slice(-3);
    if (latest.length >= 3 && latest.every(x => Number(x.sample || 0) >= 4)) {
      const first = Number(latest[0]?.avgBrier);
      const last = Number(latest[latest.length - 1]?.avgBrier);
      if (Number.isFinite(first) && Number.isFinite(last) && last <= first - 0.025) {
        notes.push({
          level: 'good',
          title: 'Последние недели выглядят лучше по ошибке Брайера',
          text: `Ошибка Брайера снизилась примерно с ${first.toFixed(3)} до ${last.toFixed(3)}. Нужна более длинная серия, чтобы считать это устойчивым улучшением.`,
        });
      }
    }
  
    if (!notes.length) {
      notes.push({
        level: 'info',
        title: 'Явных диагностических отклонений нет',
        text: 'Продолжаем накапливать неизменяемые предматчевые снимки. Контроль результатов и безопасное восстановление не меняют веса модели автоматически.',
      });
    }
  
    return notes.slice(0, 5);
  }
  
  
  function modelVersionName(row) {
    const version = String(row?.analysis_version || '').trim();
    return version || 'legacy / unknown';
  }
  
  function weightedTopCalibrationError(rows) {
    const defs = [
      [0, 45], [45, 55], [55, 65], [65, 75], [75, 101],
    ];
    const valid = (rows || []).filter(modelQualityEligibleRow);
    if (!valid.length) return null;
  
    let weighted = 0;
    let used = 0;
    for (const [min, max] of defs) {
      const group = valid.filter(row => {
        const top = topProbabilityValue(row);
        return Number.isFinite(Number(top)) && top >= min && top < max;
      });
      if (!group.length) continue;
      const predicted = average(group.map(topProbabilityValue));
      const actual = pct(group.filter(row => row.correct === true).length, group.length);
      if (!Number.isFinite(Number(predicted)) || !Number.isFinite(Number(actual))) continue;
      weighted += Math.abs(Number(predicted) - Number(actual)) * group.length;
      used += group.length;
    }
    return used ? dashboardRound(weighted / used, 1) : null;
  }
  
  function buildModelVersionCohorts(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const version = modelVersionName(row);
      if (!groups.has(version)) groups.set(version, []);
      groups.get(version).push(row);
    }
  
    return [...groups.entries()].map(([version, cohortRows]) => {
      const bucket = dashboardBucket(cohortRows, version, { version });
      const kickoffTimes = cohortRows.map(row => Date.parse(row?.kickoff_at || '')).filter(Number.isFinite);
      const signalReady = cohortRows.filter(row => {
        const signalMap = parseJsonObject(row?.signal_probabilities);
        return signalMap && Object.keys(signalMap).length > 0;
      }).length;
      return {
        ...bucket,
        calibrationError: weightedTopCalibrationError(cohortRows),
        signalSnapshotCoverage: pct(signalReady, cohortRows.length),
        firstKickoffAt: kickoffTimes.length ? new Date(Math.min(...kickoffTimes)).toISOString() : null,
        lastKickoffAt: kickoffTimes.length ? new Date(Math.max(...kickoffTimes)).toISOString() : null,
      };
    }).sort((a, b) =>
      Date.parse(b.lastKickoffAt || 0) - Date.parse(a.lastKickoffAt || 0) ||
      Number(b.sample || 0) - Number(a.sample || 0)
    );
  }
  
  
  function buildModelDashboard(rows, days) {
    const valid = (rows || []).filter(modelQualityEligibleRow);
    const overview = dashboardBucket(valid, 'Все прогнозы');
    const dashboard = {
      version: '6.1',
      periodDays: days,
      generatedAt: new Date().toISOString(),
      overview,
      trend: buildWeeklyDashboard(valid, 10),
      confidence: buildConfidenceDashboard(valid),
      completeness: buildCompletenessDashboard(valid),
      leagues: buildLeagueDashboard(valid),
      outcomes: buildOutcomeDashboard(valid),
      versions: buildModelVersionCohorts(valid),
      weightedCalibrationError: weightedTopCalibrationError(valid),
      signals: buildSignalDashboard(valid),
      calibrationModes: buildCalibrationModeDashboard(valid),
    };
    dashboard.observations = buildModelDashboardObservations(valid, dashboard);
    dashboard.note = 'Панель использует неизменяемые предматчевые снимки и фактические результаты. Группы версий носят описательный характер: система не выбирает «лучшую» версию и ничего не продвигает автоматически.';
    return dashboard;
  }
  
  
  function publicTrackRecordSampleState(sample = 0) {
    const n=Math.max(0,Number(sample || 0));
    if (!n) return {code:'empty',label:'Данных пока нет',message:'Подтверждённая история модели только формируется.'};
    if (n<20) return {code:'early',label:'Малая выборка',message:'Матчей пока мало — цифры показывают только раннюю историю и могут заметно меняться.'};
    if (n<50) return {code:'forming',label:'Выборка формируется',message:'История уже полезна для проверки модели, но всё ещё чувствительна к каждому новому матчу.'};
    return {code:'informative',label:'Выборка информативнее',message:'Накоплено больше подтверждённых матчей, но прошлые результаты всё равно не гарантируют будущие.'};
  }
  
  function buildPublicAiTrackRecord(settledRows = [], pendingRows = [], days = 180) {
    const rows=verifiedSettledRows(settledRows,pendingRows);
    const matched=rows.filter(row=>row.correct===true).length;
    const missed=rows.filter(row=>row.correct===false).length;
    const brierValues=rows.map(verifiedBrierScore).filter(Number.isFinite);
    const avgBrier=brierValues.length ? Math.round((average(brierValues) || 0)*1000)/1000 : null;
    const overRows=rows.filter(row=>typeof row.over25_correct==='boolean');
    const bttsRows=rows.filter(row=>typeof row.btts_correct==='boolean');
    const sampleState=publicTrackRecordSampleState(rows.length);
    const recent=rows.slice(0,8).map(row=>({
      fixtureId:Number(row.fixture_id || 0),
      kickoffAt:row.kickoff_at || null,
      league:String(row.league_name || ''),
      home:String(row.home_name || ''),
      away:String(row.away_name || ''),
      score:`${Number(row.actual_home_goals)}:${Number(row.actual_away_goals)}`,
      predictedOutcome:String(row.predicted_outcome || ''),
      predictedLabel:predictionOutcomeLabel(row.predicted_outcome,row.home_name,row.away_name),
      actualOutcome:String(row.actual_outcome || ''),
      actualLabel:predictionOutcomeLabel(row.actual_outcome,row.home_name,row.away_name),
      topProbability:Math.round(topProbabilityValue(row)*10)/10,
      matched:row.correct===true,
      brier:Number.isFinite(verifiedBrierScore(row)) ? Math.round(verifiedBrierScore(row)*1000)/1000 : null,
    }));
    return {
      available:true,
      periodDays:Number(days || 180),
      generatedAt:new Date().toISOString(),
      sample:{
        verified:rows.length,
        matched,
        missed,
        pending:Number((pendingRows || []).length),
        excluded:Math.max(0,Number((settledRows || []).length)-rows.length),
        state:sampleState.code,
        label:sampleState.label,
        message:sampleState.message,
      },
      probabilityQuality:{
        avgBrier,
        label:'Ошибка Брайера',
        explanation:'Показывает качество всех вероятностей П1 / Н / П2 одновременно. Ниже — лучше; размер выборки всегда показывается рядом.',
      },
      secondary:{
        over25:{sample:overRows.length,matched:overRows.filter(row=>row.over25_correct===true).length,missed:overRows.filter(row=>row.over25_correct===false).length},
        btts:{sample:bttsRows.length,matched:bttsRows.filter(row=>row.btts_correct===true).length,missed:bttsRows.filter(row=>row.btts_correct===false).length},
      },
      recent,
      methodology:{
        immutablePrematch:true,
        verifiedOnly:true,
        profitabilityMetric:false,
        note:'Используются только неизменяемые предматчевые снимки с подтверждённым или административно разобранным финальным результатом.',
        disclaimer:'Совпадение исхода не равно доходности ставки. MatchRadar AI показывает историю модели и качество вероятностей, а не обещание будущего результата.',
      },
    };
  }
  
  async function loadPublicAiTrackRecord(cfg, days = 180, options = {}) {
    const allowed=[90,180,365];
    const period=allowed.includes(Number(days))?Number(days):180;
    const cacheKey=`public:ai-track-record:${period}:v1`;
    if (!options.force) {
      const cached=await getCache(cacheKey,cfg).catch(()=>null);
      if (cached?.available) return {...cached,cached:true};
    }
    const since=new Date(Date.now()-period*86400_000).toISOString();
    let settled=[],pending=[];
    if (hasSupabase(cfg)) {
      [settled,pending]=await Promise.all([
        supaSelectMany(cfg,'model_predictions',{status:'eq.settled',kickoff_at:`gte.${since}`},{limit:500,order:'kickoff_at.desc'}),
        supaSelectMany(cfg,'model_predictions',{status:'eq.pending',kickoff_at:`gte.${since}`},{limit:500,order:'kickoff_at.desc'}),
      ]);
    } else {
      const all=[...memory.modelPredictions.values()].filter(row=>Date.parse(row.kickoff_at || '')>=Date.parse(since));
      settled=all.filter(row=>row.status==='settled').sort((a,b)=>Date.parse(b.kickoff_at || 0)-Date.parse(a.kickoff_at || 0));
      pending=all.filter(row=>row.status==='pending');
    }
    const result=buildPublicAiTrackRecord(settled,pending,period);
    await setCache(cacheKey,0,result,cfg,10).catch(()=>null);
    return result;
  }
  
  async function apiAiTrackRecord(request, cfg) {
    const url=new URL(request.url);
    const days=Number(url.searchParams.get('days') || 180);
    try {
      // Public callers may choose the reporting window, but must not bypass
      // the shared cache and amplify reads from model_predictions.
      return json(await loadPublicAiTrackRecord(cfg,days));
    } catch (error) {
      return json({available:false,reason:'История качества AI временно недоступна.',detail:redactOpsString(error?.message || error,160)},503);
    }
  }
  
  function publicAiTrackRecordDrill() {
    const base={status:'settled',settlement_verification_state:'confirmed',captured_at:'2026-09-22T17:00:00Z',kickoff_at:'2026-09-22T18:00:00Z',home_prob:55,draw_prob:25,away_prob:20,predicted_outcome:'home',home_name:'Home',away_name:'Away',league_name:'League',over25_prob:60,btts_prob:52};
    const hit={...base,fixture_id:1,actual_home_goals:2,actual_away_goals:1,actual_outcome:'home',correct:true,over25_correct:true,btts_correct:true};
    const miss={...base,fixture_id:2,kickoff_at:'2026-09-21T18:00:00Z',captured_at:'2026-09-21T17:00:00Z',actual_home_goals:0,actual_away_goals:1,actual_outcome:'away',correct:false,over25_correct:false,btts_correct:false};
    const unverified={...hit,fixture_id:3,settlement_verification_state:'unverified'};
    const result=buildPublicAiTrackRecord([hit,miss,unverified],[],180);
    return {pass:result.sample.verified===2 && result.sample.matched===1 && result.sample.missed===1 && result.sample.state==='early' && result.recent.length===2 && result.methodology.profitabilityMetric===false,cases:6};
  }

  return {
    loadModelPredictionForFixture,
    postMatchOutcomeLabel,
    postMatchPredictionProbability,
    postMatchStatValue,
    buildPostMatchReview,
    postMatchReviewDrill,
    average,
    pct,
    qualityBucket,
    dashboardRound,
    dashboardLogLoss,
    dashboardCompletenessPercent,
    dashboardBucket,
    dashboardWeekKey,
    dashboardWeekLabel,
    buildWeeklyDashboard,
    buildLeagueDashboard,
    buildConfidenceDashboard,
    buildCompletenessDashboard,
    buildCalibrationModeDashboard,
    buildSignalDashboard,
    buildOutcomeDashboard,
    buildModelDashboardObservations,
    modelVersionName,
    weightedTopCalibrationError,
    buildModelVersionCohorts,
    buildModelDashboard,
    publicTrackRecordSampleState,
    buildPublicAiTrackRecord,
    loadPublicAiTrackRecord,
    apiAiTrackRecord,
    publicAiTrackRecordDrill
  };
}
