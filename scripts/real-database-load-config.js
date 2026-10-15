// Only an explicitly acknowledged disposable loopback Supabase, never hosted targets.
export function localLoadDatabaseConfig(env={}) {
  if(env.ISOLATED_REAL_DB_ACK!=='disposable')throw new Error('Explicit disposable database acknowledgement required.');
  let url;
  try {url=new URL(env.LOCAL_LOAD_SUPABASE_URL);} catch {throw new Error('Local load database URL required.');}
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.port!=='54321' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('Only http://127.0.0.1:54321 is allowed for disposable load.');
  const key=env.LOCAL_LOAD_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string' || !key.trim())throw new Error('Disposable local service role key required.');
  return {url:url.origin,key};
}
