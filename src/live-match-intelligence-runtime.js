// Live match intelligence helpers extracted from worker.js.
// Numeric parsing remains injected by the composition root.
export function createLiveMatchIntelligenceRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Live match intelligence runtime dependencies are required.');
  }
  const {
    numericValue,
  } = deps;

  if (typeof numericValue !== 'function') {
    throw new TypeError('numericValue is required');
  }

  const LIVE_MAX_MINUTE=180;

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number=numericValue(value);
    return Number.isFinite(number) ? number : null;
  }

  function boundedNumber(value,min,max) {
    const number=finiteNumber(value);
    return number !== null && number >= min && number <= max ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=finiteNumber(value);
    return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function metricValue(key,value) {
    const limits={
      'Ball Possession':[0,100],
      'expected_goals':[0,20],
      'Total Shots':[0,100],
      'Shots on Goal':[0,100],
      'Corner Kicks':[0,50],
      'Goalkeeper Saves':[0,50],
      'Red Cards':[0,10],
    };
    const range=limits[String(key || '')] || [0,10000];
    return boundedNumber(value,range[0],range[1]);
  }

  function displayText(value,fallback='',max=160) {
    if (!['string','number','bigint'].includes(typeof value)) return String(fallback || '').slice(0,max);
    const text=String(value).trim();
    return (text || fallback).slice(0,max);
  }

  function normalizedPressure(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const home=boundedNumber(value.home,0,100);
    const away=boundedNumber(value.away,0,100);
    if (home === null || away === null || Math.abs((home+away)-100) > 2) return null;
    const leader=value.leader === 'home' || value.leader === 'away' || value.leader === 'balanced'
      ? value.leader
      : Math.abs(home-away)<10 ? 'balanced' : home>away ? 'home' : 'away';
    return {home,away,leader};
  }

  function eventMinute(value) {
    return boundedNumber(value,0,LIVE_MAX_MINUTE);
  }

  function scoreValue(value) {
    return boundedNumber(value,0,30);
  }

  function formatPlayerLeaders(rowsInput, homeId, awayId) {
    const sides={home:[],away:[]};
    const homeTeamId=positiveSafeInteger(homeId);
    const awayTeamId=positiveSafeInteger(awayId);
    if (!homeTeamId || !awayTeamId || homeTeamId===awayTeamId) return sides;
    for (const teamRow of rows(rowsInput)) {
      const teamId=positiveSafeInteger(teamRow?.team?.id);
      const side=teamId===homeTeamId ? 'home' : teamId===awayTeamId ? 'away' : '';
      if (!side) continue;
      for (const entry of rows(teamRow?.players)) {
        const st=rows(entry?.statistics)[0] || {};
        const rating=boundedNumber(st?.games?.rating,0,10);
        const minutes=boundedNumber(st?.games?.minutes,0,150) ?? 0;
        const goals=boundedNumber(st?.goals?.total,0,20) ?? 0;
        const assists=boundedNumber(st?.goals?.assists,0,20) ?? 0;
        const saves=boundedNumber(st?.goals?.saves,0,50) ?? 0;
        const shotsOn=boundedNumber(st?.shots?.on,0,50) ?? 0;
        const keyPasses=boundedNumber(st?.passes?.key,0,100) ?? 0;
        const tackles=boundedNumber(st?.tackles?.total,0,100) ?? 0;
        const interceptions=boundedNumber(st?.tackles?.interceptions,0,100) ?? 0;
        if (!minutes && rating === null && !goals && !assists && !saves && !shotsOn && !keyPasses && !tackles && !interceptions) continue;
        const impact=(rating ?? 0)*10+goals*20+assists*14+saves*2+shotsOn*2+keyPasses*1.5+tackles+interceptions;
        if (!Number.isFinite(impact)) continue;
        sides[side].push({
          id:positiveSafeInteger(entry?.player?.id),
          name:displayText(entry?.player?.name,'Игрок',120),
          photo:displayText(entry?.player?.photo,'',1000),
          position:displayText(st?.games?.position,'',40),
          rating:rating !== null ? Math.round(rating*10)/10 : null,
          minutes,
          goals,
          assists,
          saves,
          shotsOn,
          keyPasses,
          tackles,
          interceptions,
          impact:Math.round(impact*10)/10,
        });
      }
    }
    for (const side of ['home','away']) {
      sides[side].sort((a,b) => b.impact - a.impact || (b.rating || 0) - (a.rating || 0) || b.minutes - a.minutes);
      sides[side] = sides[side].slice(0, 6);
    }
    return sides;
  }
  
  function livePressure(statistics) {
    const items=rows(statistics?.items);
    if (!items.length) return null;
    const get=key=>items.find(item=>item?.key===key) || null;
    const pair=(key,homeWeight,awayWeight=homeWeight)=>{
      const item=get(key);
      const home=metricValue(key,item?.home);
      const away=metricValue(key,item?.away);
      if (home === null || away === null) return null;
      return {home:home*homeWeight,away:away*awayWeight};
    };
    const components=[
      pair('Shots on Goal',4.2),
      pair('Total Shots',1.25),
      pair('Corner Kicks',1.4),
      pair('Ball Possession',0.07),
      pair('Red Cards',-7),
    ].filter(Boolean);
    const saves=get('Goalkeeper Saves');
    const homeSaves=metricValue('Goalkeeper Saves',saves?.home);
    const awaySaves=metricValue('Goalkeeper Saves',saves?.away);
    const hasSavePair=homeSaves !== null && awaySaves !== null;
    if (!components.length && !hasSavePair) return null;
    let homeScore=0,awayScore=0;
    for (const component of components) {
      homeScore+=component.home;
      awayScore+=component.away;
    }
    // Opponent goalkeeper saves indicate attacking pressure by the other side.
    if (hasSavePair) {
      homeScore+=awaySaves*.8;
      awayScore+=homeSaves*.8;
    }
    const h=Math.max(0,homeScore);
    const a=Math.max(0,awayScore);
    const total=h+a;
    if (!Number.isFinite(total) || total<1) return null;
    const home=Math.round(h/total*100);
    const away=100-home;
    const diff=home-away;
    return {
      home,
      away,
      leader:Math.abs(diff)<10 ? 'balanced' : diff>0 ? 'home' : 'away',
      note:'Эвристика давления по ударам, владению, угловым, сейвам и карточкам. Это не вероятность победы.',
    };
  }
  
  
  function smartStat(statistics, key, side) {
    if (side !== 'home' && side !== 'away') return null;
    const row=rows(statistics?.items).find(item=>item?.key===key);
    return metricValue(key,row?.[side]);
  }
  
  function smartSideName(side, homeName, awayName) {
    return side === 'home'
      ? displayText(homeName,'Хозяева',120)
      : side === 'away'
        ? displayText(awayName,'Гости',120)
        : '';
  }
  
  function smartInsight(type, side, icon, title, text, importance = 'medium', metrics = []) {
    return {
      type:displayText(type,'',60),
      side:['home','away','balanced','neutral'].includes(side) ? side : 'neutral',
      icon:displayText(icon,'',8),
      title:displayText(title,'',160),
      text:displayText(text,'',1000),
      importance:['high','medium','low'].includes(importance) ? importance : 'medium',
      metrics:rows(metrics).slice(0,10),
    };
  }
  
  function recentEventSummary(events, elapsed, homeName, awayName) {
    const eventRows=rows(events);
    const minute=eventMinute(elapsed);
    if (!eventRows.length || minute === null) return null;
    const cutoff=Math.max(0,minute-15);
    const recent=eventRows.filter(event=>{
      const eventAt=eventMinute(event?.minute);
      return eventAt !== null && eventAt >= cutoff && eventAt <= minute;
    });
    if (!recent.length) return null;
  
    const score = { home: 0, away: 0 };
    const key = { home: 0, away: 0 };
    for (const e of recent) {
      const side = e.side === 'home' || e.side === 'away' ? e.side : '';
      if (!side) continue;
      const t = String(e.type || '').toLowerCase();
      const d = String(e.detail || '').toLowerCase();
      if (t === 'goal' && !d.includes('missed')) { score[side] += 1; key[side] += 4; }
      else if (t === 'card' && d.includes('red')) key[side] -= 2;
      else if (t === 'var') key[side] += 1;
    }
  
    const diff = key.home - key.away;
    if (score.home || score.away) {
      const leader = score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'balanced';
      return {
        leader,
        title: 'Последние 15 минут',
        text: leader === 'balanced'
          ? `На последнем отрезке команды обменялись голевыми событиями (${score.home}:${score.away}).`
          : `${smartSideName(leader, homeName, awayName)} активнее на последнем отрезке: голы за 15 минут — ${score[leader]}:${score[leader === 'home' ? 'away' : 'home']}.`,
        homeScore: key.home,
        awayScore: key.away,
      };
    }
    if (Math.abs(diff) >= 2) {
      const leader = diff > 0 ? 'home' : 'away';
      return {
        leader,
        title: 'Последний отрезок',
        text: `${smartSideName(leader, homeName, awayName)} чаще оказывается в центре ключевых событий последних 15 минут.`,
        homeScore: key.home,
        awayScore: key.away,
      };
    }
    return null;
  }
  
  function sideFromPrematchSignal(code = '') {
    const normalized=String(code || '').trim().toLowerCase();
    if (['home','double_home'].includes(normalized)) return 'home';
    if (['away','double_away'].includes(normalized)) return 'away';
    return 'balanced';
  }
  
  function livePerformanceSide({ statistics, pressure } = {}) {
    const hxg=smartStat(statistics,'expected_goals','home'),axg=smartStat(statistics,'expected_goals','away');
    if (hxg !== null && axg !== null && Math.abs(hxg-axg)>=.35) return hxg>axg ? 'home' : 'away';
    const hso=smartStat(statistics,'Shots on Goal','home'),aso=smartStat(statistics,'Shots on Goal','away');
    if (hso !== null && aso !== null && Math.abs(hso-aso)>=2) return hso>aso ? 'home' : 'away';
    const normalized=normalizedPressure(pressure);
    if (normalized?.leader === 'home' || normalized?.leader === 'away') return normalized.leader;
    return 'balanced';
  }
  
  function liveMarketShift(oddsMovement = null) {
    const changes=oddsMovement?.probabilityChange;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
    const values={
      home:boundedNumber(changes.home,-100,100),
      draw:boundedNumber(changes.draw,-100,100),
      away:boundedNumber(changes.away,-100,100),
    };
    if (Object.values(values).some(value=>value === null)) return null;
    const net=values.home+values.draw+values.away;
    if (!Number.isFinite(net) || Math.abs(net)>1) return null;
    const candidates=Object.entries(values).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const [side,delta]=candidates[0] || [];
    if (!side || Math.abs(delta)<3) return null;
    return {side,delta:Math.round(delta*10)/10};
  }
  
  function buildLiveAiCoach({ statistics, events, pressure, score, elapsed, homeName, awayName, smartInsights, prematch, oddsMovement, xgQuality = null } = {}) {
    const minuteValue=eventMinute(elapsed);
    const eventRows=rows(events).filter(event=>{
      const eventAt=eventMinute(event?.minute);
      return eventAt !== null
        && (minuteValue === null || eventAt <= minuteValue);
    });
    const minute=minuteValue ?? 0;
    const homeGoals=scoreValue(score?.home);
    const awayGoals=scoreValue(score?.away);
    const scoreKnown=homeGoals !== null && awayGoals !== null;
    const hg=homeGoals ?? 0;
    const ag=awayGoals ?? 0;
    const hxg=smartStat(statistics,'expected_goals','home'),axg=smartStat(statistics,'expected_goals','away');
    const hred=smartStat(statistics,'Red Cards','home') ?? 0,ared=smartStat(statistics,'Red Cards','away') ?? 0;
    const pressureValue=normalizedPressure(pressure);
    const performanceSide=livePerformanceSide({statistics,pressure:pressureValue});
    const pressureLeader=pressureValue?.leader || 'balanced';
    const pressureLeaderLabel=pressureLeader==='home'
      ? smartSideName('home',homeName,awayName)
      : pressureLeader==='away'
        ? smartSideName('away',homeName,awayName)
        : 'Баланс';
    const chanceSide=hxg!==null&&axg!==null&&Math.abs(hxg-axg)>=.25?(hxg>axg?'home':'away'):performanceSide;
    const chanceLabel=chanceSide==='home'
      ? `${smartSideName('home',homeName,awayName)} опаснее`
      : chanceSide==='away'
        ? `${smartSideName('away',homeName,awayName)} опаснее`
        : 'Без явного перевеса';
    const recent=recentEventSummary(eventRows,minuteValue,homeName,awayName);
    const marketShift=liveMarketShift(oddsMovement);
    const pre=prematch?.aiInstructor && typeof prematch.aiInstructor === 'object' && !Array.isArray(prematch.aiInstructor)
      ? prematch.aiInstructor
      : null;
    const preSignal=pre?.betSignal && typeof pre.betSignal === 'object' && !Array.isArray(pre.betSignal)
      ? pre.betSignal
      : null;
    const preCode=String(preSignal?.code || '').trim().toLowerCase();
    const expectedSide=sideFromPrematchSignal(preCode);
    let support=0,contradiction=0;
    if (preCode==='skip') contradiction+=1;
    if (expectedSide==='home' || expectedSide==='away') {
      const other=expectedSide==='home'?'away':'home';
      const expectedGoals=expectedSide==='home'?hg:ag, otherGoals=other==='home'?hg:ag;
      if (performanceSide===expectedSide) support += 1.2;
      if (pressureLeader===expectedSide && Math.abs((pressureValue?.home ?? 50)-(pressureValue?.away ?? 50))>=12) support += .8;
      if (scoreKnown && expectedGoals>otherGoals) support += minute>=45?1.2:.7;
      if (performanceSide===other) contradiction += 1.2;
      if (scoreKnown && otherGoals>expectedGoals) contradiction += minute>=45?1.5:.8;
      if ((expectedSide==='home'?hred:ared) > (other==='home'?hred:ared)) contradiction += 1.8;
    } else if (preCode==='over25') {
      const totalGoals=scoreKnown ? hg+ag : null;
      const totalXg=(hxg ?? 0)+(axg ?? 0);
      if ((scoreKnown && totalGoals>=2) || (minuteValue !== null && minute<=60 && totalXg>=1.8)) support += 2;
      if (scoreKnown && minuteValue !== null && minute>=60 && totalGoals===0 && totalXg<1.2) contradiction += 2;
    } else if (preCode==='btts') {
      if (scoreKnown && hg>0 && ag>0) support += 2;
      if (scoreKnown && minuteValue !== null && minute>=65 && (hg===0 || ag===0) && ((hg===0?hxg:axg) ?? 0)<.5) contradiction += 1.8;
    }
    if (recent?.leader && recent.leader===expectedSide) support += .5;
    if (recent?.leader && expectedSide!=='balanced' && recent.leader!==expectedSide && recent.leader!=='balanced') contradiction += .5;
  
    let state='neutral', stateLabel='Пока без вывода';
    if (!pre) { state='shifted'; stateLabel='Нет предматчевого снимка'; }
    else if (preCode==='skip') { state='wait'; stateLabel='До матча: пропуск'; }
    else if (contradiction>=3 && contradiction>support+1) { state='broken'; stateLabel='Сценарий сломан'; }
    else if (contradiction>=1.8 && contradiction>support) { state='weakened'; stateLabel='Сценарий ослаб'; }
    else if (support>=1.8 && support>=contradiction+.5) { state='holds'; stateLabel='Сценарий подтверждается'; }
    else { state='shifted'; stateLabel='Сценарий меняется'; }
  
    const dataScore=boundedNumber(smartInsights?.dataScore,0,100) ?? 0;
    const confidence=Math.max(20,Math.min(92,Math.round(
      dataScore*.68
      + (minuteValue !== null ? Math.min(90,minute)/90*14 : 0)
      + (pressureValue ? 8 : 0)
      + (eventRows.length ? 6 : 0)
    )));
    const recentCritical=minuteValue !== null && eventRows.some(event=>{
      const eventAt=eventMinute(event?.minute);
      if (eventAt === null || eventAt < Math.max(0,minute-10) || eventAt > minute) return false;
      const type=String(event?.type || '').toLowerCase();
      const detail=String(event?.detail || '').toLowerCase();
      return type==='goal' || (type==='card' && detail.includes('red'));
    });
    let volatilityLabel='Средний',volatilityReason='Картина матча может измениться после одного ключевого эпизода.';
    if (hred!==ared || recentCritical || Math.abs(marketShift?.delta ?? 0)>=8) {
      volatilityLabel='Высокий';
      volatilityReason='Есть удаление, недавнее ключевое событие или резкий сдвиг рынка.';
    } else if (scoreKnown && minuteValue !== null && minute>=75 && Math.abs(hg-ag)<=1) {
      volatilityLabel='Высокий';
      volatilityReason='Концовка близкого матча — один эпизод может полностью изменить сценарий.';
    } else if (pressureValue && Math.abs(pressureValue.home-pressureValue.away)<10) {
      volatilityLabel='Умеренный';
      volatilityReason='По текущим показателям матч остаётся достаточно ровным.';
    }
  
    let action={code:'watch',label:'Наблюдать',reason:'Собираю ещё несколько устойчивых сигналов по ходу матча.'};
    if (confidence<45 || dataScore<35) action={code:'wait',label:'Ждать больше данных',reason:'Покрытия пока мало для уверенного live-вывода.'};
    else if (state==='broken') action={code:'avoid',label:'Не опираться на предматчевый сигнал',reason:'Текущий счёт и игровая картина заметно противоречат исходному сценарию.'};
    else if (state==='weakened') action={code:'watch',label:'Сценарий под вопросом',reason:'Есть признаки против исходной идеи; важны следующие 5–10 минут.'};
    else if (state==='holds' && confidence>=62) action={code:'hold',label:'Сценарий подтверждается',reason:'Счёт и/или качество игры пока не противоречат предматчевой идее.'};
    else if (!pre) action={code:'watch',label:'Читать матч по LIVE-данным',reason:'Предматчевого AI-снимка нет, поэтому сравнение строится только по текущей игре.'};
  
    const watch=[];
    if (pressureLeader==='home' || pressureLeader==='away') watch.push(`${pressureLeaderLabel}: сохранится ли перевес по давлению в следующие 5–10 минут.`);
    if (hxg!==null && axg!==null) watch.push(`xG сейчас ${hxg.toFixed(2)}:${axg.toFixed(2)} — важно, продолжает ли расти преимущество по качеству моментов.`);
    if (hred!==ared) watch.push('Удаление меняет базовый сценарий: отдельно следите за ударами и территорией после красной карточки.');
    else if (recent?.text) watch.push(recent.text);
    if (marketShift) { const n=marketShift.side==='home'?smartSideName('home',homeName,awayName):marketShift.side==='away'?smartSideName('away',homeName,awayName):'ничью'; watch.push(`Рынок заметно сдвинулся в сторону ${n}: ${marketShift.delta>0?'+':''}${marketShift.delta} п.п. по расчётной вероятности.`); }
    if (!watch.length) watch.push('Следите за ударами в створ, xG и первым заметным изменением давления.');
  
    const mainTeam=performanceSide==='home'
      ? smartSideName('home',homeName,awayName)
      : performanceSide==='away'
        ? smartSideName('away',homeName,awayName)
        : '';
    let headline='Матч пока читается осторожно';
    if (state==='holds') headline='Предматчевый сценарий держится';
    else if (state==='weakened') headline='Предматчевый сценарий ослабевает';
    else if (state==='broken') headline='Матч ушёл против предматчевого сценария';
    else if (!pre && mainTeam) headline=`${mainTeam} выглядит убедительнее по LIVE-данным`;
    else if (mainTeam) headline=`${mainTeam} сейчас выглядит активнее`;
    const summary=state==='broken'
      ? 'AI больше не считает корректным опираться на исходную предматчевую идею без переоценки текущих данных.'
      : state==='weakened'
        ? 'Часть текущих сигналов расходится с тем, что ожидалось до матча. Live-картина важнее старого прогноза.'
        : state==='holds'
          ? 'Текущие данные в целом поддерживают исходный сценарий, но красная карточка, гол или резкий сдвиг давления могут быстро его изменить.'
          : 'AI оценивает только то, что реально видно сейчас по счёту, событиям, статистике и рынку.';
  
    return {
      available:Boolean(smartInsights?.available === true || pressureValue || eventRows.length),
      state,
      headline,
      summary,
      confidence,
      action,
      volatility:{label:volatilityLabel,reason:volatilityReason},
      current:{
        pressure:pressureValue ? {home:pressureValue.home,away:pressureValue.away} : null,
        pressureLeaderLabel,
        chanceLabel,
        xg:{home:hxg,away:axg},
        xgQuality:xgQuality && typeof xgQuality === 'object' && !Array.isArray(xgQuality)
          ? {
              state:displayText(xgQuality.state,'',40),
              label:displayText(xgQuality.label,'',120),
              confidenceBearing:xgQuality.confidenceBearing === true,
            }
          : null,
        performanceSide,
        marketShift,
        scoreKnown,
        minute:minuteValue,
      },
      prematch:{
        available:Boolean(pre),
        signal:displayText(preSignal?.label,'',160),
        outcome:displayText(pre?.verdict?.outcome,'',160),
        confidence:boundedNumber(pre?.confidenceScore,0,100) ?? 0,
        stateLabel,
      },
      watchNext:watch.slice(0,3),
    };
  }
  function buildSmartMatchInsights({
    statistics, events, pressure, score, elapsed, status,
    homeName, awayName, playerLeaders, absences,
  } = {}) {
    const insights=[];
    const eventRows=rows(events);
    const pressureValue=normalizedPressure(pressure);
    const minute=eventMinute(elapsed);
    const homeGoalValue=scoreValue(score?.home);
    const awayGoalValue=scoreValue(score?.away);
    const scoreKnown=homeGoalValue !== null && awayGoalValue !== null;
    const homeGoals=homeGoalValue ?? 0;
    const awayGoals=awayGoalValue ?? 0;
  
    const hs = smartStat(statistics, 'Total Shots', 'home');
    const as = smartStat(statistics, 'Total Shots', 'away');
    const hso = smartStat(statistics, 'Shots on Goal', 'home');
    const aso = smartStat(statistics, 'Shots on Goal', 'away');
    const hxg = smartStat(statistics, 'expected_goals', 'home');
    const axg = smartStat(statistics, 'expected_goals', 'away');
    const hpos = smartStat(statistics, 'Ball Possession', 'home');
    const apos = smartStat(statistics, 'Ball Possession', 'away');
    const hcorn = smartStat(statistics, 'Corner Kicks', 'home');
    const acorn = smartStat(statistics, 'Corner Kicks', 'away');
    const hsaves = smartStat(statistics, 'Goalkeeper Saves', 'home');
    const asaves = smartStat(statistics, 'Goalkeeper Saves', 'away');
    const hred = smartStat(statistics, 'Red Cards', 'home') || 0;
    const ared = smartStat(statistics, 'Red Cards', 'away') || 0;
  
    if (pressureValue && Math.abs(pressureValue.home-pressureValue.away)>=12) {
      const side=pressureValue.home>pressureValue.away ? 'home' : 'away';
      const own=side==='home' ? pressureValue.home : pressureValue.away;
      const opp=side==='home' ? pressureValue.away : pressureValue.home;
      insights.push(smartInsight(
        'pressure', side, '⚡', 'Территориальное давление',
        `${smartSideName(side, homeName, awayName)} сильнее по совокупности ударов, владения, угловых и других доступных метрик (${own}:${opp} по индексу давления).`,
        Math.abs(own - opp) >= 24 ? 'high' : 'medium',
        [{label:'Индекс давления',home:pressureValue.home,away:pressureValue.away}]
      ));
    }
  
    if (hxg !== null && axg !== null && Math.abs(hxg - axg) >= 0.45) {
      const side = hxg > axg ? 'home' : 'away';
      insights.push(smartInsight(
        'chance_quality', side, '🎯', 'Качество моментов',
        `${smartSideName(side, homeName, awayName)} создаёт более качественные моменты по xG: ${hxg.toFixed(2)} — ${axg.toFixed(2)}.`,
        Math.abs(hxg - axg) >= 0.9 ? 'high' : 'medium',
        [{ label: 'xG', home: hxg, away: axg }]
      ));
    } else if (hso !== null && aso !== null && hs !== null && as !== null) {
      const shotEdge = (hso - aso) * 2 + (hs - as) * 0.45;
      if (Math.abs(shotEdge) >= 3) {
        const side = shotEdge > 0 ? 'home' : 'away';
        insights.push(smartInsight(
          'chance_volume', side, '🥅', 'Объём атак',
          `${smartSideName(side, homeName, awayName)} чаще доводит атаки до ударов: ${hs}:${as}, в створ — ${hso}:${aso}.`,
          'medium',
          [{ label: 'Удары', home: hs, away: as }, { label: 'В створ', home: hso, away: aso }]
        ));
      }
    }
  
    const scoreLeader = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'balanced';
    let performanceLeader = 'balanced';
    if (hxg !== null && axg !== null && Math.abs(hxg - axg) >= 0.5) performanceLeader = hxg > axg ? 'home' : 'away';
    else if (hso !== null && aso !== null && hs !== null && as !== null) {
      const perf = (hso - aso) * 2 + (hs - as) * 0.5;
      if (Math.abs(perf) >= 3.5) performanceLeader = perf > 0 ? 'home' : 'away';
    }
    if (scoreKnown && scoreLeader !== 'balanced' && performanceLeader !== 'balanced' && scoreLeader !== performanceLeader) {
      insights.push(smartInsight(
        'score_mismatch', performanceLeader, '↔️', 'Счёт расходится с картиной игры',
        `${smartSideName(scoreLeader, homeName, awayName)} ведёт ${homeGoals}:${awayGoals}, но по качеству/объёму моментов сильнее выглядит ${smartSideName(performanceLeader, homeName, awayName)}.`,
        'high'
      ));
    } else if (scoreKnown && scoreLeader === 'balanced' && performanceLeader !== 'balanced') {
      insights.push(smartInsight(
        'score_mismatch', performanceLeader, '↔️', 'При равном счёте есть перевес',
        `Счёт равный, но ${smartSideName(performanceLeader, homeName, awayName)} имеет заметное преимущество по доступным атакующим показателям.`,
        'medium'
      ));
    }
  
    if (scoreKnown && hxg !== null && homeGoals-hxg>=0.8) {
      insights.push(smartInsight('finishing', 'home', '🔥', 'Реализация выше ожидаемой',
        `${homeName} забил ${homeGoals} при xG ${hxg.toFixed(2)} — реализация заметно выше качества созданных моментов.`, 'medium'));
    }
    if (scoreKnown && axg !== null && awayGoals-axg>=0.8) {
      insights.push(smartInsight('finishing', 'away', '🔥', 'Реализация выше ожидаемой',
        `${awayName} забил ${awayGoals} при xG ${axg.toFixed(2)} — реализация заметно выше качества созданных моментов.`, 'medium'));
    }
  
    if (hred > 0 || ared > 0) {
      const side = hred > ared ? 'home' : ared > hred ? 'away' : 'balanced';
      const text = side === 'balanced'
        ? `У обеих команд есть удаления (${hred}:${ared}), что сильно меняет структуру матча.`
        : `${smartSideName(side, homeName, awayName)} играет в меньшинстве: красные карточки ${hred}:${ared}.`;
      insights.push(smartInsight('discipline', side, '🟥', 'Удаление влияет на матч', text, 'high'));
    }
  
    if (hsaves !== null && hsaves >= 4 && (aso === null || aso >= hsaves)) {
      insights.push(smartInsight('goalkeeper', 'home', '🧤', 'Вратарь удерживает хозяев',
        `Вратарь ${homeName} уже сделал ${hsaves} сейвов — его вклад заметен в текущем счёте.`, 'medium'));
    }
    if (asaves !== null && asaves >= 4 && (hso === null || hso >= asaves)) {
      insights.push(smartInsight('goalkeeper', 'away', '🧤', 'Вратарь удерживает гостей',
        `Вратарь ${awayName} уже сделал ${asaves} сейвов — его вклад заметен в текущем счёте.`, 'medium'));
    }
  
    if (hpos !== null && apos !== null && Math.abs(hpos - apos) >= 16) {
      const side = hpos > apos ? 'home' : 'away';
      insights.push(smartInsight('possession', side, '🧠', 'Контроль мяча',
        `${smartSideName(side, homeName, awayName)} значительно больше владеет мячом: ${hpos}% — ${apos}%. Владение само по себе не гарантирует более опасные моменты.`,
        'low'));
    }
  
    if (hcorn !== null && acorn !== null && Math.abs(hcorn - acorn) >= 5) {
      const side = hcorn > acorn ? 'home' : 'away';
      insights.push(smartInsight('territory', side, '🚩', 'Территориальный перевес',
        `${smartSideName(side, homeName, awayName)} чаще доводит атаки до угловых: ${hcorn}:${acorn}.`, 'low'));
    }
  
    const recent=recentEventSummary(eventRows,minute,homeName,awayName);
    if (recent) {
      insights.push(smartInsight('recent_phase', recent.leader, '⏱️', recent.title, recent.text, 'medium'));
    }
  
    const leaders=[
      ...rows(playerLeaders?.home).map(player=>({...player,side:'home'})),
      ...rows(playerLeaders?.away).map(player=>({...player,side:'away'})),
    ].filter(player=>(boundedNumber(player?.rating,0,10) ?? 0)>=7.5)
      .sort((a,b)=>(boundedNumber(b?.rating,0,10) ?? 0)-(boundedNumber(a?.rating,0,10) ?? 0));
    if (leaders[0]) {
      const player=leaders[0];
      const playerName=displayText(player?.name,'Игрок',120);
      const rating=boundedNumber(player?.rating,0,10);
      const goals=boundedNumber(player?.goals,0,20) ?? 0;
      const assists=boundedNumber(player?.assists,0,20) ?? 0;
      insights.push(smartInsight(
        'player',
        player.side,
        '⭐',
        'Выделяется игрок',
        `${playerName} — один из самых заметных по доступной статистике${rating !== null ? `, рейтинг ${rating.toFixed(1)}` : ''}${goals ? `, голов: ${goals}` : ''}${assists ? `, ассистов: ${assists}` : ''}.`,
        'low',
      ));
    }
  
    const hAbs=rows(absences?.home).length;
    const aAbs=rows(absences?.away).length;
    if (Math.abs(hAbs - aAbs) >= 2 && Math.max(hAbs, aAbs) >= 2) {
      const side = hAbs > aAbs ? 'home' : 'away';
      insights.push(smartInsight('availability', side, '🩺', 'Разница по потерям',
        `${smartSideName(side, homeName, awayName)} имеет больше актуальных отметок о потерях состава после сверки с опубликованными составами: ${hAbs}:${aAbs}.`, 'low'));
    }
  
    if (minute !== null && minute>=20 && hs !== null && as !== null) {
      const projectedShots=((hs+as)/Math.max(1,minute))*90;
      if (projectedShots>=28) {
        insights.push(smartInsight('tempo', 'balanced', '🏃', 'Высокий темп',
          `По текущей частоте ударов матч идёт в высоком темпе — около ${Math.round(projectedShots)} ударов в пересчёте на 90 минут.`, 'low'));
      } else if (projectedShots<=13 && minute>=35) {
        insights.push(smartInsight('tempo', 'balanced', '🧱', 'Закрытый характер',
          `Ударов немного для текущей минуты матча — темп создания моментов пока низкий.`, 'low'));
      }
    }
  
    const importanceRank = { high: 3, medium: 2, low: 1 };
    const typeRank = { score_mismatch: 9, discipline: 8, chance_quality: 7, pressure: 6, chance_volume: 5, goalkeeper: 4, recent_phase: 3, finishing: 3, possession: 2, territory: 2, player: 1, availability: 1, tempo: 1 };
    insights.sort((a,b) => (importanceRank[b.importance] - importanceRank[a.importance]) || ((typeRank[b.type] || 0) - (typeRank[a.type] || 0)));
  
    const coverageParts = [
      hxg !== null && axg !== null,
      hs !== null && as !== null,
      hso !== null && aso !== null,
      hpos !== null && apos !== null,
      eventRows.length>0,
      Boolean(pressureValue),
      rows(playerLeaders?.home).length+rows(playerLeaders?.away).length>0,
    ];
    const dataScore = Math.round(coverageParts.filter(Boolean).length / coverageParts.length * 100);
    const dataLabel = dataScore >= 75 ? 'Высокое покрытие' : dataScore >= 45 ? 'Среднее покрытие' : 'Базовое покрытие';
  
    const main = insights[0] || null;
    const headline=main?.title || (pressureValue?.leader==='balanced' ? 'Матч выглядит сбалансированным' : 'Недостаточно данных для сильного вывода');
    const summary = main?.text || 'Доступных событий и статистики пока недостаточно для содержательного автоматического вывода.';
  
    return {
      available: Boolean(insights.length),
      headline,
      summary,
      dataScore,
      dataLabel,
      insights: insights.slice(0, 7),
      methodology: 'Автоматические выводы строятся только из текущего счёта, событий и официальной статистики матча. Это объяснение происходящего, а не прогноз результата.',
      generatedForStatus:displayText(status,'',40),
      scoreKnown,
      minute,
    };
  }
  
  
  return Object.freeze({
    formatPlayerLeaders,
    livePressure,
    smartStat,
    smartSideName,
    smartInsight,
    recentEventSummary,
    sideFromPrematchSignal,
    livePerformanceSide,
    liveMarketShift,
    buildLiveAiCoach,
    buildSmartMatchInsights,
  });
}
