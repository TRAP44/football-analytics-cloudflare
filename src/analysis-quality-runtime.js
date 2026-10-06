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

  const requiredFunctions={
    absenceAdjustmentUnits,
    assessMatchLineups,
    probabilityLeaderMargin,
  };
  for (const [name,fn] of Object.entries(requiredFunctions)) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }

  function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function rows(value, limit = 100) {
    return Array.isArray(value) ? value.slice(0,limit) : [];
  }

  function safeText(value, max = 180) {
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

  function finiteRange(value, min, max) {
    const number=finiteNumber(value);
    return number !== null && number >= min && number <= max ? number : null;
  }

  function nonNegativeInteger(value, max = 1000) {
    const number=finiteNumber(value);
    return number !== null
      && Number.isSafeInteger(number)
      && number >= 0
      && number <= max
      ? number
      : 0;
  }

  function safeProbabilityVector(value) {
    const source=objectValue(value);
    if (!source) return null;
    const home=finiteRange(source.home,0,100);
    const draw=finiteRange(source.draw,0,100);
    const away=finiteRange(source.away,0,100);
    if (home === null || draw === null || away === null) return null;
    const total=home+draw+away;
    if (!Number.isFinite(total) || Math.abs(total-100)>2.5) return null;
    return {home,draw,away};
  }

  function safeLineupQuality(lineups) {
    try {
      const quality=objectValue(assessMatchLineups(lineups));
      if (quality) return quality;
    } catch {}
    return {
      home:{confirmed:false},
      away:{confirmed:false},
      anyPublished:false,
      bothPublished:false,
      bothConfirmed:false,
      confirmedSides:0,
      partialSides:0,
    };
  }

  function featureReliability(reliability, feature) {
    return objectValue(objectValue(reliability)?.features?.[feature]);
  }

  function safeAbsenceUnits(list) {
    try {
      const value=finiteRange(absenceAdjustmentUnits(list),0,160);
      return value === null ? 0 : Math.round(value*10)/10;
    } catch {
      return 0;
    }
  }

  function buildLineupImpact({
    absences,
    lineups,
    homeName='Хозяева',
    awayName='Гости',
    reliability=null,
  }={}) {
    const homeLabel=safeText(homeName,120) || 'Хозяева';
    const awayLabel=safeText(awayName,120) || 'Гости';
    const absenceData=objectValue(absences) || {};
    const homeRows=rows(absenceData.home);
    const awayRows=rows(absenceData.away);
    const homeAbs=homeRows.length;
    const awayAbs=awayRows.length;

    const lineupQuality=safeLineupQuality(lineups);
    const structuralHomeConfirmed=lineupQuality?.home?.confirmed === true;
    const structuralAwayConfirmed=lineupQuality?.away?.confirmed === true;
    const lineupFeature=featureReliability(reliability,'lineups');
    const lineupSourceTrusted=!lineupFeature || (
      lineupFeature.confidenceBearing === true
      && lineupFeature.stale !== true
      && lineupFeature.confirmed !== false
    );
    const homeConfirmed=Boolean(structuralHomeConfirmed && lineupSourceTrusted);
    const awayConfirmed=Boolean(structuralAwayConfirmed && lineupSourceTrusted);

    const injuryFeature=featureReliability(reliability,'injuries');
    const inferredInjuryState=homeAbs || awayAbs ? 'available' : 'unknown';
    const injuryState=safeText(injuryFeature?.state,60).toLowerCase() || inferredInjuryState;
    const lineupState=safeText(lineupFeature?.state,60).toLowerCase()
      || (structuralHomeConfirmed || structuralAwayConfirmed ? 'available' : 'unknown');
    const injuryUsable=injuryFeature
      ? injuryFeature.confidenceBearing === true
        && injuryFeature.stale !== true
        && injuryState === 'available'
      : injuryState === 'available';

    const summary=objectValue(absenceData.summary) || {};
    const homeSummary=objectValue(summary.home) || {};
    const awaySummary=objectValue(summary.away) || {};
    const hs=Math.min(homeAbs,nonNegativeInteger(homeSummary.suspension,100));
    const as=Math.min(awayAbs,nonNegativeInteger(awaySummary.suspension,100));
    const hi=Math.min(
      homeAbs,
      nonNegativeInteger(homeSummary.injury,100)+nonNegativeInteger(homeSummary.illness,100),
    );
    const ai=Math.min(
      awayAbs,
      nonNegativeInteger(awaySummary.injury,100)+nonNegativeInteger(awaySummary.illness,100),
    );
    const hd=Math.min(homeAbs,nonNegativeInteger(homeSummary.doubtful,100));
    const ad=Math.min(awayAbs,nonNegativeInteger(awaySummary.doubtful,100));
    const reconciled=nonNegativeInteger(summary.resolvedByLineup,200);

    const homeRoleMatched=homeRows.filter(row=>objectValue(row)?.seasonRole?.matched === true).length;
    const awayRoleMatched=awayRows.filter(row=>objectValue(row)?.seasonRole?.matched === true).length;
    const homeUnits=injuryUsable ? safeAbsenceUnits(homeRows) : 0;
    const awayUnits=injuryUsable ? safeAbsenceUnits(awayRows) : 0;
    const diff=homeAbs-awayAbs;

    let label=injuryUsable
      ? 'Баланс отмеченных потерь близкий'
      : 'Данные о потерях требуют проверки';
    let note=injuryUsable
      ? `По данным источника после сверки с составом: ${homeLabel} — ${homeAbs}, ${awayLabel} — ${awayAbs}. Травмы/болезни ${hi}:${ai}, дисквалификации ${hs}:${as}, под вопросом ${hd}:${ad}.`
      : injuryState==='empty_response'
        ? 'Источник не вернул записей о травмах или дисквалификациях; это не считается подтверждением полного состава.'
        : 'Источник не подтвердил данные о потерях; нулевые потери не предполагаются.';

    if (reconciled>0) {
      note+=` ${reconciled} устаревших отметок исключено, потому что игрок уже указан в опубликованном составе.`;
    }
    if (injuryUsable && homeRoleMatched+awayRoleMatched>0) {
      note+=` Сезонная игровая нагрузка сопоставлена для ${homeRoleMatched+awayRoleMatched} отмеченных игроков; ограниченная взвешенная нагрузка потерь ${homeUnits}:${awayUnits}. Это не рейтинг качества игрока.`;
    }
    if (injuryUsable && diff>=2) {
      label=`Потерь больше у ${homeLabel}`;
      note+=` У ${homeLabel} больше актуальных отметок о возможном отсутствии.`;
    } else if (injuryUsable && diff<=-2) {
      label=`Потерь больше у ${awayLabel}`;
      note+=` У ${awayLabel} больше актуальных отметок о возможном отсутствии.`;
    }

    if (homeConfirmed && awayConfirmed) {
      note+=' Стартовые составы опубликованы полностью для обеих команд и подтверждены надёжным источником.';
    } else if (
      structuralHomeConfirmed
      && structuralAwayConfirmed
      && !lineupSourceTrusted
    ) {
      note+=' Оба стартовых состава структурно полные, но источник не прошёл проверку свежести или provenance, поэтому они не считаются подтверждённым сигналом.';
    } else if (nonNegativeInteger(lineupQuality?.partialSides,2)>0) {
      note+=' Опубликованные составы неполные: подтверждение требует ровно 11 уникальных игроков старта у каждой команды.';
    } else if (structuralHomeConfirmed || structuralAwayConfirmed) {
      note+=' Полный стартовый состав опубликован только у одной команды; для рабочего сигнала этого недостаточно.';
    } else if (lineupState==='empty_response') {
      note+=' Источник пока не вернул опубликованные стартовые составы.';
    } else if (lineupState==='skipped') {
      note+=' Проверка составов сейчас пропущена по политике квоты/времени.';
    } else {
      note+=' Стартовые составы источником пока не подтверждены.';
    }

    return {
      homeAbsences:homeAbs,
      awayAbsences:awayAbs,
      homeConfirmed,
      awayConfirmed,
      structuralHomeConfirmed,
      structuralAwayConfirmed,
      lineupsTrusted:lineupSourceTrusted,
      label,
      note,
      lineupQuality,
      injuryState,
      lineupState,
      availabilityState:injuryState,
      availabilityTrusted:injuryUsable,
      availabilityUnits:{home:homeUnits,away:awayUnits},
      seasonRoleCoverage:{
        home:{matched:homeRoleMatched,total:homeAbs},
        away:{matched:awayRoleMatched,total:awayAbs},
      },
      categories:{
        home:{injuryOrIllness:hi,suspension:hs,doubtful:hd},
        away:{injuryOrIllness:ai,suspension:as,doubtful:ad},
      },
      resolvedByLineup:reconciled,
      methodology:'Сезонная роль используется только при точном ID или однозначном совпадении имени из уже сохранённой Team Intelligence статистики; вес ограничен 0.85–1.60, сомнительный статус дополнительно уменьшает вклад вдвое. Состав считается подтверждённым для quality gate только при структурно полном XI и доверенном свежем источнике.',
    };
  }

  function marketMovementNote(movement={}) {
    const source=objectValue(movement);
    const delta=objectValue(source?.probabilityChange);
    const sample=nonNegativeInteger(source?.sample,10000);
    if (!source || !delta || sample<2) {
      return 'История движения коэффициентов ещё собирается.';
    }

    const values={
      home:finiteRange(delta.home,-100,100),
      draw:finiteRange(delta.draw,-100,100),
      away:finiteRange(delta.away,-100,100),
    };
    if (Object.values(values).some(value=>value === null)) {
      return 'Данные движения рынка не прошли проверку.';
    }

    const movementRows=[
      ['П1',values.home],
      ['Н',values.draw],
      ['П2',values.away],
    ].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    const [label,value]=movementRows[0];
    if (Math.abs(value)<1) {
      return 'Существенного движения рынка по 1X2 пока нет.';
    }
    return `Рынок сместился к ${label}: ${value>0?'+':''}${value.toFixed(1)} п.п. по подразумеваемой вероятности.`;
  }

  function analysisQualityGate({
    probabilities,
    confidence,
    dataTrustScore,
    providerReliability=null,
    lineupImpact=null,
    minutesToKickoff=null,
  }={}) {
    const reasons=[];
    const probabilityInput=objectValue(probabilities);
    const safeProbabilities=safeProbabilityVector(probabilities);
    const confidenceData=objectValue(confidence) || {};
    const signalCount=nonNegativeInteger(confidenceData.signalCount,20);
    const confidenceScore=finiteRange(confidenceData.score,0,100) ?? 0;
    const disagreement=finiteRange(confidenceData.disagreement,0,100) ?? 100;
    const agreement=finiteRange(confidenceData.agreement,0,100) ?? 0;
    const trust=finiteRange(dataTrustScore,0,100) ?? 0;

    let margin=0;
    let marginKnown=false;
    if (safeProbabilities) {
      try {
        const value=finiteRange(probabilityLeaderMargin(safeProbabilities),0,100);
        if (value !== null) {
          margin=value;
          marginKnown=true;
        }
      } catch {}
    }

    const kickoffMinutes=finiteRange(minutesToKickoff,-1440,10080);
    const nearKickoff=kickoffMinutes !== null
      && kickoffMinutes <= 15
      && kickoffMinutes >= -5;
    const lineupWindow=kickoffMinutes !== null
      && kickoffMinutes <= 90
      && kickoffMinutes >= -5;
    const lineupsConfirmed=Boolean(
      objectValue(lineupImpact)?.homeConfirmed === true
      && objectValue(lineupImpact)?.awayConfirmed === true
    );

    if (!probabilityInput) {
      reasons.push({
        code:'probabilities_missing',
        level:'block',
        text:'Недостаточно подтверждённых данных для расчёта исхода.',
      });
    } else if (!safeProbabilities) {
      reasons.push({
        code:'probabilities_invalid',
        level:'block',
        text:'Расчётные вероятности не прошли проверку диапазона и суммы.',
      });
    } else if (!marginKnown) {
      reasons.push({
        code:'leader_margin_unavailable',
        level:'hold',
        text:'Не удалось надёжно определить разрыв между лидирующими исходами.',
      });
    }

    if (signalCount<2) {
      reasons.push({
        code:'signal_count',
        level:'hold',
        text:'Нужны как минимум два независимых модельных сигнала.',
      });
    }
    if (confidenceScore<56) {
      reasons.push({
        code:'confidence',
        level:'hold',
        text:'Уверенность модели ниже рабочего порога 56/100.',
      });
    }
    if (trust<60) {
      reasons.push({
        code:'data_trust',
        level:'hold',
        text:'Полнота и надёжность входных данных ниже рабочего порога 60/100.',
      });
    }
    if (disagreement>=14) {
      reasons.push({
        code:'disagreement',
        level:'hold',
        text:'Источники слишком сильно расходятся между собой.',
      });
    }
    if (signalCount>=2 && agreement<55) {
      reasons.push({
        code:'leader_agreement',
        level:'hold',
        text:'Большинство весов источников не поддерживает итогового лидера.',
      });
    }
    if (safeProbabilities && marginKnown && margin<5 && confidenceScore<68) {
      reasons.push({
        code:'thin_margin',
        level:'hold',
        text:'Разрыв между первым и вторым исходом слишком мал для рабочего сигнала.',
      });
    }
    if (nearKickoff && !lineupsConfirmed) {
      reasons.push({
        code:'lineups_final_window',
        level:'hold',
        text:'До старта осталось мало времени, но оба стартовых состава ещё не подтверждены.',
      });
    } else if (lineupWindow && !lineupsConfirmed) {
      reasons.push({
        code:'lineups_pending',
        level:'caution',
        text:'Стартовые составы ещё могут изменить оценку матча.',
      });
    }

    const provider=objectValue(providerReliability);
    if (provider) {
      const providerState=safeText(provider.state,40).toLowerCase();
      const trustCap=finiteRange(provider.trustCap,0,100);
      if (trustCap === null) {
        reasons.push({
          code:'provider_reliability_invalid',
          level:'hold',
          text:'Оценка надёжности источника имеет некорректный формат.',
        });
      } else if (providerState==='degraded') {
        reasons.push({
          code:'provider_degraded',
          level:trustCap<70 ? 'hold' : 'caution',
          text:'Часть входных данных провайдера недоступна или ограничена.',
        });
      } else if (providerState==='partial') {
        reasons.push({
          code:'provider_partial',
          level:trustCap<70 ? 'hold' : 'caution',
          text:'Часть входных данных пока не подтверждена источником.',
        });
      }
    }

    const blocked=reasons.some(reason=>reason.level==='block');
    const held=reasons.some(reason=>reason.level==='hold');
    const state=blocked ? 'blocked' : held ? 'hold' : reasons.length ? 'caution' : 'ready';

    return {
      state,
      allowSignal: state === 'ready' || state === 'caution',
      label:state==='ready'
        ? 'Рабочее качество'
        : state==='caution'
          ? 'Нужна осторожность'
          : state==='hold'
            ? 'Сигнал удержан'
            : 'Анализ заблокирован',
      reasons,
      metrics:{
        confidenceScore,
        dataTrustScore:trust,
        signalCount,
        disagreement,
        agreement,
        leaderMargin:margin,
        leaderMarginKnown:marginKnown,
        lineupsConfirmed,
      },
    };
  }

  function analysisQualityGateSelfTest() {
    const ready=analysisQualityGate({
      probabilities:{home:55,draw:25,away:20},
      confidence:{score:75,signalCount:3,disagreement:5,agreement:82},
      dataTrustScore:85,
      providerReliability:{state:'healthy',trustCap:100},
      lineupImpact:{homeConfirmed:true,awayConfirmed:true},
      minutesToKickoff:120,
    });
    const hold=analysisQualityGate({
      probabilities:{home:41,draw:31,away:28},
      confidence:{score:52,signalCount:1,disagreement:16,agreement:40},
      dataTrustScore:55,
      providerReliability:{state:'degraded',trustCap:60},
      lineupImpact:{homeConfirmed:false,awayConfirmed:false},
      minutesToKickoff:10,
    });
    const malformed=analysisQualityGate({
      probabilities:{home:Infinity,draw:0,away:0},
      confidence:{score:Infinity,signalCount:99,disagreement:NaN,agreement:100},
      dataTrustScore:Infinity,
      providerReliability:{state:'healthy',trustCap:100},
      lineupImpact:{homeConfirmed:true,awayConfirmed:true},
      minutesToKickoff:120,
    });

    return {
      pass:ready.state==='ready'
        && ready.allowSignal
        && hold.state==='hold'
        && !hold.allowSignal
        && hold.reasons.some(reason=>reason.code==='lineups_final_window')
        && hold.reasons.some(reason=>reason.code==='data_trust')
        && malformed.state==='blocked'
        && !malformed.allowSignal
        && malformed.reasons.some(reason=>reason.code==='probabilities_invalid'),
      ready:ready.state,
      hold:hold.state,
      malformed:malformed.state,
      holdReasons:hold.reasons.map(reason=>reason.code),
    };
  }

  return Object.freeze({
    buildLineupImpact,
    marketMovementNote,
    analysisQualityGate,
    analysisQualityGateSelfTest,
  });
}
