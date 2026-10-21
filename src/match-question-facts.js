import {buildExplanationFacts,validProbabilities} from './match-explanation-runtime.js';

const text=value=>typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,100) : '';
const count=value=>typeof value==='number' && Number.isInteger(value) && value>=0 && value<=60 ? value : null;
const metric=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=20 ? value : null;
const decimal=value=>String(Math.round(value*100)/100).replace('.',',');
const present=value=>value && !/^(?:unknown|null|undefined|tbd|n\/a|неизвестно|не указан|-)$/i.test(value);

// Questions need ordinary match facts even when they are not a strong model
// signal. Keep this separate from the intentionally selective explanation.
export function buildMatchQuestionFacts(payload={}){
  const facts=buildExplanationFacts(payload).filter(fact=>!['confidence_low','confidence_high','data_limited'].includes(fact.id));
  const add=(id,value,priority=40)=>{
    if(!value)return;
    const index=facts.findIndex(fact=>fact.id===id);
    const fact={id,role:index>=0 ? facts[index].role : 'caveat',text:value,priority};
    if(index>=0)facts[index]=fact;else facts.push(fact);
  };
  const probabilities=validProbabilities(payload?.probabilities);
  if(probabilities){
    const home=text(payload?.match?.home?.name).slice(0,60) || 'Хозяева';
    const away=text(payload?.match?.away?.name).slice(0,60) || 'Гости';
    const percent=value=>(Math.round(value*10)/10).toString().replace('.',',');
    add('outcome_probabilities',`Оценка модели: победа ${home} — ${percent(probabilities.home)}%, ничья — ${percent(probabilities.draw)}%, победа ${away} — ${percent(probabilities.away)}%.`);
  }
  const expected=payload?.goalModel;
  if(metric(expected?.homeExpected)!==null && metric(expected?.awayExpected)!==null){
    const home=text(payload?.match?.home?.name) || 'Хозяева',away=text(payload?.match?.away?.name) || 'Гости';
    add('expected_goals',`Ожидаемые голы по модели: ${home} — ${decimal(expected.homeExpected)}, ${away} — ${decimal(expected.awayExpected)}. Это оценка, а не точный счёт.`);
  }
  const h2h=payload?.h2h;
  const h2hValues=['homeWins','draws','awayWins'].map(key=>h2h?.[key]);
  if(h2hValues.every(value=>typeof value==='number' && Number.isInteger(value) && value>=0 && value<=200) && h2hValues.reduce((a,b)=>a+b,0)>0){
    const [homeWins,draws,awayWins]=h2hValues;
    add('h2h',`В последних ${homeWins+draws+awayWins} очных встречах: победы ${text(payload?.match?.home?.name) || 'хозяев'} — ${homeWins}, ничьи — ${draws}, победы ${text(payload?.match?.away?.name) || 'гостей'} — ${awayWins}.`,60);
  }
  const rawDate=payload?.match?.date;
  if(typeof rawDate==='string' && /^\d{4}-\d{2}-\d{2}T/.test(rawDate) && Number.isFinite(Date.parse(rawDate))){
    const kickoff=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(rawDate));
    add('kickoff',`Начало матча — ${kickoff} МСК${text(payload?.match?.league) ? `. Турнир: ${text(payload.match.league)}` : ''}.`);
  }
  const referee=text(payload?.match?.referee);
  if(present(referee))add('referee',`Главный судья — ${referee}.`);
  const venue=text(payload?.match?.venue),city=text(payload?.match?.city);
  if(present(venue))add('venue',`Стадион — ${venue}${present(city) ? `, ${city}` : ''}.`);
  for(const side of ['home','away']){
    const name=text(payload?.match?.[side]?.name) || (side==='home'?'Хозяева':'Гости');
    const form=payload?.recentForm?.[side]?.overall;
    const values=['sample','wins','draws','losses'].map(key=>count(form?.[key]));
    if(values.every(value=>value!==null) && values[0]>0 && values[1]+values[2]+values[3]===values[0]){
      const [sample,wins,draws,losses]=values;
      add(`form_${side}`,`${name} за последние ${sample} матчей: побед — ${wins}, ничьих — ${draws}, поражений — ${losses}.`,facts.find(fact=>fact.id===`form_${side}`)?.priority || 35);
    }
    const sample=count(form?.sample);
    if(sample!==null && sample>0){
      if(metric(form?.gfAvg)!==null)add(`attack_${side}`,`${name} за последние ${sample} матчей забивает в среднем ${decimal(form.gfAvg)} гола за игру.`);
      if(metric(form?.gaAvg)!==null)add(`defence_${side}`,`${name} за последние ${sample} матчей пропускает в среднем ${decimal(form.gaAvg)} гола за игру.`);
    }
    const absences=payload?.absences?.[side];
    if(Array.isArray(absences) && absences.length>0 && absences.length<=60){
      const names=absences.slice(0,3).map(player=>text(player?.name || player?.player?.name)).filter(Boolean);
      add(`absences_${side}`,`${name}: вне заявки или под вопросом — ${absences.length}${names.length ? ` (${names.join(', ')})` : ''}.`,75);
    }
    const lineup=payload?.lineups?.[side];
    const starters=Array.isArray(lineup?.startXI) ? lineup.startXI : [];
    const names=starters.slice(0,11).map(player=>text(player?.player?.name || player?.name)).filter(present);
    if(names.length){
      const confirmed=payload?.lineupQuality?.bothConfirmed===true && starters.length===11 && names.length===11;
      add(`starters_${side}`,`${name} — ${confirmed ? 'подтверждённый старт' : 'опубликованные игроки стартового состава'}: ${names.join(', ')}.`,50);
    }
    const formation=text(lineup?.formation);
    if(payload?.lineupQuality?.bothConfirmed===true && formation && /^\d(?:-\d){1,4}$/.test(formation)){
      add(`lineups_${side}`,`${name}: подтверждённый состав, схема ${formation}.`,45);
    }
  }
  return facts;
}

export function directMatchQuestionTopic(question=''){
  const q=String(question).toLowerCase().replace(/ё/g,'е').replace(/[?!.,…]/g,'').replace(/\s+/g,' ').trim();
  if(/^(?:сколько (?:голов|мячей)(?: (?:будет|ожидается|ждать))?(?: (?:в|на) (?:этом )?матче)?|(?:ожидаемые голы|прогноз голов)(?: (?:на|в) матч)?|будет ли (?:много|мало) голов(?: в (?:этом )?матче)?|что (?:модель|ai|аи) (?:говорит|думает) о (?:результативности|голах)(?: (?:этого )?матча)?|насколько результативным будет (?:этот )?матч|какой счет (?:ожидается|прогнозируется)(?: в (?:этом )?матче)?)$/u.test(q))return 'goals';
  if(/^(?:(?:какие|каковы) (?:вероятности|шансы)(?: исходов| на исходы)?|вероятности(?: исходов)?|(?:какова|какая) вероятность ничьей|шансы на ничью)$/u.test(q))return 'outcome_probabilities';
  if(/^(?:кто (?:в старте|в стартовом составе|выйдет в старте)|(?:покажи|назови) (?:старт|стартовый состав)|стартовый состав)$/u.test(q) && !/ и |почему|если|вместо|замен|травм/u.test(q))return 'starters';
  if(!/(?: и |почему|строг|стиль|карточ|сколько|пенальти|замен|смен|раньше|предыдущ|помощник|боков|линейн|вар|var|четверт|форм|травм|гол|исход|состав)/u.test(q)
    && /^(?:кто|как зовут|назови|имя|главный судья|главный арбитр|судья|арбитр)(?:\s|$)/u.test(q) && /судь|арбитр|судит/u.test(q))return 'referee';
  if(!/трансляц|смотреть|телеканал| и /u.test(q) && /^(?:где (?:играют|играет|пройдет|проходит|будет матч)|на каком стадионе|какой стадион|стадион)(?:\s|$)/u.test(q))return 'venue';
  return null;
}
