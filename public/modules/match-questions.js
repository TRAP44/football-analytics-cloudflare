// Match-scoped conversational UI. All prose is escaped; model paragraphs are
// validated on the server before they reach this transcript.

const ROLES = new Set(['lead', 'support', 'risk', 'caveat']);
const MAX_LENGTH = 200;

const UNAVAILABLE = Object.freeze({
  user_limit: 'Лимит вопросов на этот час исчерпан. Попробуйте позже.',
  daily_limit: 'На сегодня лимит вопросов к AI исчерпан.',
  ai_unavailable: 'AI сейчас не ответил. Попробуйте спросить позже.',
  ai_disabled: 'AI-ассистент временно недоступен.',
  disabled: 'Вопросы по матчу временно выключены.',
  analysis_disabled: 'Вопросы по матчу временно недоступны.',
  analysis_unavailable: 'Данные разбора устарели — обновите разбор матча и спросите снова.',
  not_in_history: 'Сначала откройте полный разбор этого матча.',
  rate_limited: 'Слишком много вопросов подряд — подождите минуту.',
  match_unavailable: 'Не удалось обновить данные матча. Попробуйте ещё раз.',
  context_expired: 'Диалог устарел. Задайте вопрос ещё раз — начнём с актуальных данных.',
});

export function matchQuestionsShellHtml(escapeHtml) {
  return `<div class="match-explanation-head"><h2>Спросить про матч</h2><small>До матча и в LIVE</small></div>
    <div class="match-question-answer" data-question-answer role="log" aria-live="polite" aria-relevant="additions text"></div>
    <form class="match-question-form" data-question-form>
      <input type="text" name="question" maxlength="${MAX_LENGTH}" autocomplete="off" placeholder="Что хотите узнать о матче?" aria-label="Вопрос про матч">
      <button type="submit" class="match-question-submit">Спросить</button>
    </form>
    <p class="match-explanation-note">Можно уточнять ответ. AI сверяется с доступными данными матча.</p>`;
}

function validItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item === 'object' && ROLES.has(item.role)
      && typeof item.connector === 'string' && item.connector.trim()
      && typeof item.text === 'string' && item.text.trim())
    .slice(0, 3);
}

export function matchQuestionAnswerHtml(data, escapeHtml) {
  const question = typeof data?.question === 'string' ? data.question.trim().slice(0, MAX_LENGTH) : '';
  const head = question ? `<p class="match-question-asked">«${escapeHtml(question)}»</p>` : '';
  const remaining = Number.isInteger(data?.remaining) && data.remaining >= 0
    ? `<small class="match-question-remaining">Осталось своих вопросов в этот час: ${data.remaining}</small>` : '';
  if (data?.available === true) {
    const items = validItems(data.items);
    if (data.answer === 'facts' && items.length) {
      return `${head}<div class="match-question-response">${items.map(item => `<p>${escapeHtml(item.text.trim().slice(0, /^starters_(home|away)$/.test(item.id) ? 1400 : 300))}</p>`).join('')}</div>${remaining}`;
    }
    if (data.answer === 'refused') return `${head}<p class="match-question-empty">Ставки мы не подсказываем. Могу рассказать, что важно в этом матче по данным.</p>${remaining}`;
    return `${head}<p class="match-question-empty">В данных этого матча ответа на этот вопрос нет.</p>${remaining}`;
  }
  const text = UNAVAILABLE[data?.reason] || 'Не удалось получить ответ. Попробуйте ещё раз.';
  return `${head}<p class="match-question-empty">${escapeHtml(text)}</p>${remaining}`;
}

const sessions=new Map();

export function conversationHtml(session,escapeHtml){
  return session.messages.slice(-6).map(message=>{
    const paragraphs=message.paragraphs || [];
    const body=paragraphs.map(paragraph=>{
      const label=paragraph.kind==='scenario' ? 'Возможный сценарий' : paragraph.kind==='analysis' ? 'Оценка AI' : '';
      return `<div class="match-chat-paragraph">${label ? `<small>${label}</small>` : ''}<p>${escapeHtml(paragraph.text)}</p></div>`;
    }).join('');
    const evidence=[...new Map(paragraphs.flatMap(item=>item.evidence || []).filter(item=>typeof item?.id==='string' && typeof item?.text==='string').map(item=>[item.id,item])).values()].slice(0,12);
    return `<article class="match-chat-turn"><p class="match-question-asked">${escapeHtml(message.question)}</p><div class="match-question-response">${body || (session.busy && message===session.messages.at(-1) ? '<p class="match-question-empty">Сверяюсь с данными матча…</p>' : '')}</div>${evidence.length ? `<details class="match-chat-evidence"><summary>На чём основан ответ</summary>${evidence.map(item=>`<p>${escapeHtml(item.text)}</p>`).join('')}</details>` : ''}${message.error ? `<p class="match-question-empty">${escapeHtml(message.error)}</p>` : ''}</article>`;
  }).join('');
}

export function mountMatchQuestions({root,fixtureId,userId=0,api,escapeHtml,accessReceipt=null,isCurrent=()=>true}={}){
  const id=Number(fixtureId),owner=String(userId);
  if(!root || !Number.isSafeInteger(id) || id<=0 || typeof api!=='function' || typeof escapeHtml!=='function')return false;
  const sessionKey=`${owner}:${id}`;
  // An account switch never inherits another person's local dialogue or proof.
  for(const [key,session] of sessions){
    if(key!==sessionKey)session.controller?.abort();
    if(!key.startsWith(`${owner}:`))sessions.delete(key);
  }
  let session=sessions.get(sessionKey);
  if(!session){
    session={messages:[],context:null,busy:false,receipt:null,remaining:null};
    sessions.set(sessionKey,session);
    if(sessions.size>8){const oldest=sessions.keys().next().value;sessions.get(oldest)?.controller?.abort();sessions.delete(oldest);}
  }
  if(typeof accessReceipt==='string' && accessReceipt.length<=100)session.receipt=accessReceipt;
  if(root.dataset.questionsMounted==='true' && root.dataset.chatSession===sessionKey)return true;
  root.dataset.fixture=String(id);root.dataset.chatSession=sessionKey;root.dataset.questionsMounted='true';
  root.innerHTML=matchQuestionsShellHtml(escapeHtml);root.hidden=false;
  const answer=root.querySelector('[data-question-answer]'),form=root.querySelector('[data-question-form]');
  const input=form?.querySelector('input[name="question"]'),submit=form?.querySelector('[type="submit"]');
  const active=()=>isCurrent() && root.isConnected && root.dataset.chatSession===sessionKey;
  session.render=()=>{
    if(!active())return;
    root.setAttribute('aria-busy',String(session.busy));
    if(submit)submit.disabled=session.busy;
    if(answer){
      const follow=session.scrollToLatest || answer.scrollHeight-answer.clientHeight-answer.scrollTop<60;
      answer.innerHTML=conversationHtml(session,escapeHtml);
      if(follow)answer.scrollTop=answer.scrollHeight;
      session.scrollToLatest=false;
    }
  };
  session.render();
  async function ask(question){
    if(session.busy)return;
    session.busy=true;session.controller=new AbortController();
    const message={question,paragraphs:[]};session.messages.push(message);
    session.scrollToLatest=true;
    session.messages=session.messages.slice(-6);
    if(input)input.value='';
    session.render();
    let terminal=false;
    try{
      const data=await api('/api/match-question',{
        method:'POST',body:JSON.stringify({fixtureId:id,mode:'conversation',question,context:session.context,...(session.receipt ? {accessReceipt:session.receipt} : {})}),
        retry:false,timeoutMs:30000,signal:session.controller.signal,
        onEvent:({type,data})=>{
          if(type==='paragraph' && message.paragraphs.length<3 && typeof data?.text==='string' && data.text.length<=2800)message.paragraphs.push(data);
          if(type==='done'){terminal=true;session.context=typeof data.context==='string' ? data.context : null;session.remaining=data.remaining;}
          if(type==='error'){terminal=true;message.error=message.paragraphs.length ? 'Ответ прервался. Можно задать вопрос ещё раз.' : UNAVAILABLE.ai_unavailable;}
          session.render();
        },
      });
      if(!terminal){
        if(data?.reason==='context_expired')session.context=null;
        if(data?.answer==='refused')message.paragraphs=[{kind:'answer',text:'Ставки мы не подсказываем. Могу обсудить сам матч.'}];
        else message.error=UNAVAILABLE[data?.reason] || 'Не удалось получить ответ. Попробуйте ещё раз.';
      }
    }catch(error){
      message.error=Number(error?.status)===429 ? UNAVAILABLE.rate_limited : message.paragraphs.length ? 'Ответ прервался. Можно задать вопрос ещё раз.' : UNAVAILABLE.ai_unavailable;
    }finally{session.busy=false;session.controller=null;session.render();}
  }
  form?.addEventListener('submit',event=>{
    event.preventDefault();
    const question=String(input?.value || '').trim();
    if(question.length<3){input?.setCustomValidity?.('Напишите вопрос хотя бы из трёх символов.');input?.reportValidity?.();return;}
    input?.setCustomValidity?.('');
    void ask(question.slice(0,MAX_LENGTH));
  });
  input?.addEventListener('input',()=>input.setCustomValidity?.(''));
  return true;
}
