// Вероятности исходов показываем целыми процентами: «58%» читается как оценка,
// а «58.2%» — как калькулятор (UX-ревью 15.10). Тройку «хозяева / ничья / гости»
// округляем методом наибольшего остатка, чтобы сумма на экране была ровно 100%.

const KEYS=['home','draw','away'];

function finitePercent(value) {
  if (value===null || value===undefined || value==='') return null;
  const number=Number(value);
  return Number.isFinite(number) && number>=0 && number<=100 ? number : null;
}

export function wholePercentTriple(value) {
  const source=value && typeof value==='object' ? value : {};
  const raw=KEYS.map(key=>{
    try {
      return finitePercent(source[key]);
    } catch {
      return null;
    }
  });
  const result={home:null,draw:null,away:null};
  const total=raw.reduce((sum,item)=>sum+(item ?? 0),0);
  const complete=raw.every(item=>item!==null);

  // Неполная тройка или сумма далеко от 100 — просто округляем каждое значение.
  if (!complete || Math.abs(total-100)>1.5) {
    KEYS.forEach((key,index)=>{
      result[key]=raw[index]===null ? null : Math.round(raw[index]);
    });
    return result;
  }

  const scaled=raw.map(item=>item*100/total);
  const floors=scaled.map(Math.floor);
  let rest=100-floors.reduce((sum,item)=>sum+item,0);
  const order=scaled
    .map((item,index)=>({index,remainder:item-floors[index]}))
    .sort((a,b)=>b.remainder-a.remainder || a.index-b.index);
  for (const {index} of order) {
    if (rest<=0) break;
    floors[index]+=1;
    rest-=1;
  }
  KEYS.forEach((key,index)=>{
    result[key]=floors[index];
  });
  return result;
}

export function wholePercentText(value) {
  const number=finitePercent(value);
  return number===null ? '—' : `${Math.round(number)}%`;
}
