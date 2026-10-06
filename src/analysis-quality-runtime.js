// Analysis quality, lineup impact and market-movement helpers extracted from worker.js.
// Domain primitives are injected by the composition root.
export function createAnalysisQualityRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Analysis quality runtime dependencies are required.');
  }
  const {
    absenceAdjustmentUnits,
    assessMatchLineups,
    probabilityLeaderMargin,
  } = deps;

  function buildLineupImpact({absences,lineups,homeName='Хозяева',awayName='Гости',reliability=null}={}) {
    const homeRows=Array.isArray(absences?.home)?absences.home:[];
    const awayRows=Array.isArray(absences?.away)?absences.away:[];
    const homeAbs=homeRows.length;
    const awayAbs=awayRows.length;
    const lineupQuality=assessMatchLineups(lineups);
    const homeConfirmed=Boolean(lineupQuality.home.confirmed);
    const awayConfirmed=Boolean(lineupQuality.away.confirmed);
    const injuryState=String(reliability?.features?.injuries?.state || (homeAbs || awayAbs ? 'available' : 'unknown'));
    const lineupState=String(reliability?.features?.lineups?.state || (homeConfirmed || awayConfirmed ? 'available' : 'unknown'));
    const injuryUsable=injuryState==='available';
    const diff=homeAbs-awayAbs;
    const hs=Number(absences?.summary?.home?.suspension || 0), as=Number(absences?.summary?.away?.suspension || 0);
    const hi=Number(absences?.summary?.home?.injury || 0)+Number(absences?.summary?.home?.illness || 0);
    const ai=Number(absences?.summary?.away?.injury || 0)+Number(absences?.summary?.away?.illness || 0);
    const hd=Number(absences?.summary?.home?.doubtful || 0), ad=Number(absences?.summary?.away?.doubtful || 0);
    const reconciled=Number(absences?.summary?.resolvedByLineup || 0);
    const homeRoleMatched=homeRows.filter(row=>row?.seasonRole?.matched).length;
    const awayRoleMatched=awayRows.filter(row=>row?.seasonRole?.matched).length;
    const homeUnits=Math.round(absenceAdjustmentUnits(homeRows)*10)/10;
    const awayUnits=Math.round(absenceAdjustmentUnits(awayRows)*10)/10;
    let label=injuryUsable?'Баланс отмеченных потерь близкий':'Данные о потерях требуют проверки';
    let note=injuryUsable
      ? `По данным источника после сверки с составом: ${homeName} — ${homeAbs}, ${awayName} — ${awayAbs}. Травмы/болезни ${hi}:${ai}, дисквалификации ${hs}:${as}, под вопросом ${hd}:${ad}.`
      : injuryState==='empty_response'
        ? 'Источник не вернул записей о травмах или дисквалификациях; это не считается подтверждением полного состава.'
        : 'Источник не подтвердил данные о потерях; нулевые потери не предполагаются.';
    if(reconciled>0) note+=` ${reconciled} устаревших отметок исключено, потому что игрок уже указан в опубликованном составе.`;
    if(homeRoleMatched+awayRoleMatched>0) note+=` Сезонная игровая нагрузка сопоставлена для ${homeRoleMatched+awayRoleMatched} отмеченных игроков; ограниченная взвешенная нагрузка потерь ${homeUnits}:${awayUnits}. Это не рейтинг качества игрока.`;
    if(injuryUsable&&diff>=2){label=`Потерь больше у ${homeName}`;note+=` У ${homeName} больше актуальных отметок о возможном отсутствии.`;}
    else if(injuryUsable&&diff<=-2){label=`Потерь больше у ${awayName}`;note+=` У ${awayName} больше актуальных отметок о возможном отсутствии.`;}
    if(homeConfirmed&&awayConfirmed) note+=' Стартовые составы опубликованы полностью для обеих команд.';
    else if(lineupQuality.partialSides>0) note+=` Опубликованные составы неполные: подтверждение требует ровно 11 уникальных игроков старта у каждой команды.`;
    else if(homeConfirmed||awayConfirmed) note+=' Полный стартовый состав подтверждён только у одной команды.';
    else if(lineupState==='empty_response') note+=' Источник пока не вернул опубликованные стартовые составы.';
    else if(lineupState==='skipped') note+=' Проверка составов сейчас пропущена по политике квоты/времени.';
    else note+=' Стартовые составы источником пока не подтверждены.';
    return {
      homeAbsences:homeAbs,awayAbsences:awayAbs,homeConfirmed,awayConfirmed,label,note,
      lineupQuality,
      injuryState,lineupState,
      availabilityState:injuryState,
      availabilityUnits:{home:homeUnits,away:awayUnits},
      seasonRoleCoverage:{home:{matched:homeRoleMatched,total:homeAbs},away:{matched:awayRoleMatched,total:awayAbs}},
      categories:{home:{injuryOrIllness:hi,suspension:hs,doubtful:hd},away:{injuryOrIllness:ai,suspension:as,doubtful:ad}},
      resolvedByLineup:reconciled,
      methodology:'Сезонная роль используется только при точном ID или однозначном совпадении имени из уже сохранённой Team Intelligence статистики; вес ограничен 0.85–1.60, сомнительный статус дополнительно уменьшает вклад вдвое.',
    };
  }

  function marketMovementNote(movement={}) {
    const delta=movement?.probabilityChange;
    if(!delta || Number(movement?.sample || 0)<2) return 'История движения коэффициентов ещё собирается.';
    const rows=[['П1',Number(delta.home||0)],['Н',Number(delta.draw||0)],['П2',Number(delta.away||0)]].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const [label,value]=rows[0];
    if(Math.abs(value)<1) return 'Существенного движения рынка по 1X2 пока нет.';
    return `Рынок сместился к ${label}: ${value>0?'+':''}${value.toFixed(1)} п.п. по подразумеваемой вероятности.`;
  }

  function analysisQualityGate({ probabilities, confidence, dataTrustScore, providerReliability = null, lineupImpact = null, minutesToKickoff = null } = {}) {
    const reasons = [];
    const signalCount = Number(confidence?.signalCount || 0);
    const confidenceScore = Number(confidence?.score || 0);
    const disagreement = Number(confidence?.disagreement || 0);
    const agreement = Number(confidence?.agreement || 0);
    const margin = probabilityLeaderMargin(probabilities);
    const trust = Number(dataTrustScore || 0);
    const nearKickoff = Number.isFinite(Number(minutesToKickoff)) && Number(minutesToKickoff) <= 15 && Number(minutesToKickoff) >= -5;
    const lineupsConfirmed = Boolean(lineupImpact?.homeConfirmed && lineupImpact?.awayConfirmed);

    if (!probabilities) reasons.push({ code:'probabilities_missing', level:'block', text:'Недостаточно подтверждённых данных для расчёта исхода.' });
    if (signalCount < 2) reasons.push({ code:'signal_count', level:'hold', text:'Нужны как минимум два независимых модельных сигнала.' });
    if (confidenceScore < 56) reasons.push({ code:'confidence', level:'hold', text:'Уверенность модели ниже рабочего порога 56/100.' });
    if (trust < 60) reasons.push({ code:'data_trust', level:'hold', text:'Полнота и надёжность входных данных ниже рабочего порога 60/100.' });
    if (disagreement >= 14) reasons.push({ code:'disagreement', level:'hold', text:'Источники слишком сильно расходятся между собой.' });
    if (agreement > 0 && agreement < 55) reasons.push({ code:'leader_agreement', level:'hold', text:'Большинство весов источников не поддерживает итогового лидера.' });
    if (margin < 5 && confidenceScore < 68) reasons.push({ code:'thin_margin', level:'hold', text:'Разрыв между первым и вторым исходом слишком мал для рабочего сигнала.' });
    if (nearKickoff && !lineupsConfirmed) reasons.push({ code:'lineups_final_window', level:'hold', text:'До старта осталось мало времени, но оба стартовых состава ещё не подтверждены.' });
    else if (Number.isFinite(Number(minutesToKickoff)) && Number(minutesToKickoff) <= 90 && !lineupsConfirmed) reasons.push({ code:'lineups_pending', level:'caution', text:'Стартовые составы ещё могут изменить оценку матча.' });
    if (providerReliability?.state === 'degraded') reasons.push({
      code:'provider_degraded',
      level:Number(providerReliability?.trustCap || 100) < 70 ? 'hold' : 'caution',
      text:'Часть входных данных провайдера недоступна или ограничена.',
    });

    const blocked = reasons.some(x => x.level === 'block');
    const held = reasons.some(x => x.level === 'hold');
    const state = blocked ? 'blocked' : held ? 'hold' : reasons.length ? 'caution' : 'ready';
    return {
      state,
      allowSignal: state === 'ready' || state === 'caution',
      label: state === 'ready' ? 'Рабочее качество'
        : state === 'caution' ? 'Нужна осторожность'
          : state === 'hold' ? 'Сигнал удержан'
            : 'Анализ заблокирован',
      reasons,
      metrics: {
        confidenceScore,
        dataTrustScore: trust,
        signalCount,
        disagreement,
        agreement,
        leaderMargin: margin,
        lineupsConfirmed,
      },
    };
  }

  function analysisQualityGateSelfTest() {
    const ready = analysisQualityGate({
      probabilities:{home:55,draw:25,away:20},
      confidence:{score:75,signalCount:3,disagreement:5,agreement:82},
      dataTrustScore:85,
      providerReliability:{state:'healthy',trustCap:100},
      lineupImpact:{homeConfirmed:true,awayConfirmed:true},
      minutesToKickoff:120,
    });
    const hold = analysisQualityGate({
      probabilities:{home:41,draw:31,away:28},
      confidence:{score:52,signalCount:1,disagreement:16,agreement:40},
      dataTrustScore:55,
      providerReliability:{state:'degraded',trustCap:60},
      lineupImpact:{homeConfirmed:false,awayConfirmed:false},
      minutesToKickoff:10,
    });
    return {
      pass: ready.state === 'ready' && ready.allowSignal && hold.state === 'hold' && !hold.allowSignal
        && hold.reasons.some(x => x.code === 'lineups_final_window')
        && hold.reasons.some(x => x.code === 'data_trust'),
      ready: ready.state,
      hold: hold.state,
      holdReasons: hold.reasons.map(x => x.code),
    };
  }

  return {
    buildLineupImpact,
    marketMovementNote,
    analysisQualityGate,
    analysisQualityGateSelfTest,
  };
}
