// Compose the already validated, ranked match facts. No LLM/provider request and
// no causal or temporal claim beyond what the current snapshot establishes.
const ATTACK=new Set(['chance_quality','chance_volume','pressure']);
const SUPPORT=new Set(['discipline','recent_phase','goalkeeper','finishing','possession','territory','player','tempo']);
export function composeLiveMatchSummary(insights=[]){
  const facts=(Array.isArray(insights)?insights:[]).filter(item=>item && typeof item.text==='string' && item.text.trim());
  const main=facts[0];
  if(!main)return '';
  const selected=[main];
  const used=new Set([main.type]);
  const add=fact=>{
    if(!fact || used.has(fact.type) || selected.some(item=>item.text===fact.text))return;
    selected.push(fact);used.add(fact.type);
  };
  // A mismatch needs its numerical evidence, while other leads retain one
  // attacking explanation without repeating correlated pressure/shot signals.
  if(main.type==='score_mismatch')add(facts.find(item=>ATTACK.has(item.type) && item.side===main.side));
  if(main.type==='discipline')add(facts.find(item=>ATTACK.has(item.type)));
  const contextual=facts.filter(item=>SUPPORT.has(item.type) && item!==main);
  for(const fact of contextual){
    if(selected.length>=3)break;
    // Possession/corners do not become a second explanation of the same edge.
    if(selected.some(item=>ATTACK.has(item.type)) && ['possession','territory'].includes(fact.type))continue;
    add(fact);
  }
  const sentences=selected.map(fact=>fact.text);
  // An event-only feed cannot establish the stronger team from a score window.
  if(main.type==='recent_phase' && !facts.some(item=>ATTACK.has(item.type) || item.type==='score_mismatch')){
    if(sentences.length>=3)sentences.pop();
    sentences.push('Убедительного преимущества по игре эти данные не подтверждают.');
  }
  return sentences.join(' ');
}
