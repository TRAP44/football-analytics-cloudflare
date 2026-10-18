import {buildExplanationFacts} from './match-explanation-runtime.js';

const text=value=>typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,100) : '';
const count=value=>typeof value==='number' && Number.isInteger(value) && value>=0 && value<=60 ? value : null;
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
    const absences=payload?.absences?.[side];
    if(Array.isArray(absences) && absences.length>0 && absences.length<=60){
      const names=absences.slice(0,3).map(player=>text(player?.name || player?.player?.name)).filter(Boolean);
      add(`absences_${side}`,`${name}: вне заявки или под вопросом — ${absences.length}${names.length ? ` (${names.join(', ')})` : ''}.`,75);
    }
    const lineup=payload?.lineups?.[side];
    const formation=text(lineup?.formation);
    if(payload?.lineupQuality?.bothConfirmed===true && formation && /^\d(?:-\d){1,4}$/.test(formation)){
      add(`lineups_${side}`,`${name}: подтверждённый состав, схема ${formation}.`,45);
    }
  }
  return facts;
}

export function directMatchQuestionTopic(question=''){
  const q=String(question).toLowerCase().replace(/ё/g,'е').replace(/[?!.,…]/g,'').replace(/\s+/g,' ').trim();
  if(!/(?: и |почему|строг|стиль|карточ|сколько|пенальти|замен|смен|раньше|предыдущ|помощник|боков|линейн|вар|var|четверт|форм|травм|гол|исход|состав)/u.test(q)
    && /^(?:кто|как зовут|назови|имя|главный судья|главный арбитр|судья|арбитр)(?:\s|$)/u.test(q) && /судь|арбитр|судит/u.test(q))return 'referee';
  if(!/трансляц|смотреть|телеканал| и /u.test(q) && /^(?:где (?:играют|играет|пройдет|проходит|будет матч)|на каком стадионе|какой стадион|стадион)(?:\s|$)/u.test(q))return 'venue';
  return null;
}
