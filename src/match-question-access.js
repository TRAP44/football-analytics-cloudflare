// Short-lived proof that this authenticated user received a full fixture
// analysis. It authorizes questions only, never generation, quota or payments.
const TTL_SECONDS=1800;
const encoder=new TextEncoder();
function id(value){return typeof value==='number' && Number.isSafeInteger(value) && value>0 ? value : 0;}
async function key(secret,usage){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);}
function message(userId,fixtureId,expires){return encoder.encode(`match-question-access:v1:${userId}:${fixtureId}:${expires}`);}
export async function issueMatchQuestionAccess(secret,userId,fixtureId,now=Date.now()){
  if(typeof secret!=='string' || !secret || !id(userId) || !id(fixtureId) || !Number.isFinite(now))return null;
  const expires=Math.floor(now/1000)+TTL_SECONDS;
  const signature=await crypto.subtle.sign('HMAC',await key(secret,'sign'),message(userId,fixtureId,expires));
  return `qa1.${expires}.${Array.from(new Uint8Array(signature),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}
export async function verifyMatchQuestionAccess(token,secret,userId,fixtureId,now=Date.now()){
  if(typeof token!=='string' || token.length>100 || typeof secret!=='string' || !secret || !id(userId) || !id(fixtureId) || !Number.isFinite(now))return false;
  const match=/^qa1\.(\d{10})\.([a-f0-9]{64})$/.exec(token);if(!match)return false;
  const expires=Number(match[1]),seconds=Math.floor(now/1000);
  if(expires<=seconds || expires>seconds+TTL_SECONDS+5)return false;
  const signature=Uint8Array.from(match[2].match(/../g),pair=>parseInt(pair,16));
  try{return await crypto.subtle.verify('HMAC',await key(secret,'verify'),signature,message(userId,fixtureId,expires));}catch{return false;}
}
