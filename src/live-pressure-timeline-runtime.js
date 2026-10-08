// Server-only, append-only history of real provider-backed LIVE pressure observations.
// A snapshot represents a successful fetch. It is NEVER a reconstructed per-minute series.
export function createLivePressureTimelineRuntime({
  memory,
  hasSupabase,
  supaInsertIgnore,
  supaSelectMany,
} = {}) {
  const local = memory?.livePressureSnapshots instanceof Map
    ? memory.livePressureSnapshots : new Map();

  function fixtureId(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }
  function pressureValue(value) {
    return typeof value === 'number' && Number.isFinite(value)
      && value >= 0 && value <= 100 ? value : null;
  }
  function validPressure(pressure) {
    const home=pressureValue(pressure?.home);
    const away=pressureValue(pressure?.away);
    return home !== null && away !== null && Math.abs(home+away-100) <= 2
      ? {home,away} : null;
  }
  function validRow(row, expectedId) {
    if (fixtureId(row?.fixture_id)!==expectedId) return null;
    const pressure=validPressure({home:row?.home_pressure,away:row?.away_pressure});
    const timestamp=Date.parse(row?.captured_at || '');
    if (!pressure || !Number.isFinite(timestamp) || row?.source !== 'verified') return null;
    const minute=row?.match_minute;
    if (minute!==null && minute!==undefined
      && (!Number.isSafeInteger(minute) || minute<0 || minute>180)) return null;
    return {
      capturedAt:new Date(timestamp).toISOString(),
      minute:minute===null || minute===undefined ? null : minute,
      home:pressure.home,
      away:pressure.away,
    };
  }
  function normalizeRows(rows,id,limit=80) {
    const sorted=new Map();
    for (const row of Array.isArray(rows)?rows:[]) {
      const valid=validRow(row,id);
      if (valid) sorted.set(valid.capturedAt,valid);
    }
    return [...sorted.values()].sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt))
      .slice(-Math.max(1,Math.min(120,limit)));
  }

  async function capture({fixtureId:rawId,pressure,minute=null,mode,meta,capturedAt},cfg) {
    const id=fixtureId(rawId),values=validPressure(pressure);
    const at=Date.parse(capturedAt || '');
    // Verify both provenance and quality before touching storage.
    if (!id || mode!=='live' || !values || !Number.isFinite(at)
      || meta?.confidenceBearing!==true || meta?.provenanceState!=='verified'
      || meta?.stale===true
      || (minute!==null && (!Number.isSafeInteger(minute) || minute<0 || minute>180))) {
      return false;
    }
    // One observation for each 2-minute UTC bucket; repeated cache requests don't write.
    const bucket=new Date(Math.floor(at/120000)*120000).toISOString();
    const row={
      snapshot_key:id+':'+bucket,
      fixture_id:id,
      captured_at:new Date(at).toISOString(),
      match_minute:minute,
      home_pressure:values.home,
      away_pressure:values.away,
      source:'verified',
    };
    const durable=typeof hasSupabase==='function' && hasSupabase(cfg);
    if (durable) {
      try {
        const ok=await supaInsertIgnore(cfg,'live_pressure_snapshots',row,'snapshot_key');
        if (ok===false) return false;
      } catch (error) {
        console.warn('LIVE pressure snapshot persistence unavailable',error?.message||error);
        return false;
      }
    }
    const previous=local.get(id)||[];
    if (!previous.some(item=>item.snapshot_key===row.snapshot_key)) {
      local.set(id,[...previous,row].slice(-120));
    }
    return true;
  }

  async function load(rawId,cfg,limit=80) {
    const id=fixtureId(rawId);
    if (!id) return [];
    const bounded=Math.max(1,Math.min(120,Number.isSafeInteger(limit)?limit:80));
    if (typeof hasSupabase==='function' && hasSupabase(cfg)) {
      try {
        const rows=await supaSelectMany(cfg,'live_pressure_snapshots',{
          fixture_id:'eq.'+id,
        },{order:'captured_at.desc',limit:bounded});
        return normalizeRows(rows,id,bounded);
      } catch (error) {
        console.warn('LIVE pressure history read unavailable',error?.message||error);
        // Never present instance-local fallback as persisted production history.
        return [];
      }
    }
    return normalizeRows(local.get(id)||[],id,bounded);
  }
  return Object.freeze({capture,load});
}
