export function createPostMatchReviewRuntime({ regulationScore, actualOutcomeFromGoals } = {}) {
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

  function buildPostMatchReview({prediction,fixture,statistics,events,homeName='',awayName=''}) {
    if (!prediction?.fixture_id) {
      return {available:false,state:'no_snapshot',headline:'Нет сохранённого предматчевого снимка',summary:'Этот матч можно изучить по фактической статистике, но честно сравнить его с AI-прогнозом нельзя: до старта снимок модели не был сохранён.',evidence:[],markets:[],calibration:{included:false}};
    }
    const score=regulationScore(fixture) || (
      Number.isFinite(Number(prediction.actual_home_goals)) && Number.isFinite(Number(prediction.actual_away_goals))
        ? {home:Number(prediction.actual_home_goals),away:Number(prediction.actual_away_goals)}
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

    if (Number.isFinite(Number(prediction.over25_prob))) {
      const overPred=Number(prediction.over25_prob)>=50;
      markets.push({code:'over25',label:'Тотал 2.5',predicted:overPred?'ТБ 2.5':'ТМ 2.5',probability:Math.round(Number(prediction.over25_prob)*10)/10,actual:overActual?'ТБ 2.5':'ТМ 2.5',correct:overPred===overActual});
    }
    if (Number.isFinite(Number(prediction.btts_prob))) {
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
    const brier=Number.isFinite(Number(prediction.brier_score)) ? Math.round(Number(prediction.brier_score)*1000)/1000 : null;
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
        confidence:Number.isFinite(Number(prediction.confidence_score))?Math.round(Number(prediction.confidence_score)):null,
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

  return Object.freeze({
    buildPostMatchReview,
    postMatchReviewDrill,
  });
}
