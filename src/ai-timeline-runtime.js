export function createAiTimelineRuntime(deps = {}) {
  const {
    analysisTimelineSnapshotRow,
    buildAiTimeline,
    getOddsSnapshots,
    hasSupabase,
    loadModelPredictionForFixture,
    memory,
    supaInsertIgnore,
    supaSelectMany
  } = deps;

  async function captureAnalysisTimelineSnapshot(payload, cfg, { delta = null } = {}) {
    const row = analysisTimelineSnapshotRow(payload, { delta });
    if (!row) return false;
  
    const fixtureId = Number(row.fixture_id || 0);
    const local = memory.analysisTimelineSnapshots.get(fixtureId) || [];
    if (!local.some(item => item.snapshot_key === row.snapshot_key)) {
      local.push(row);
      local.sort((a, b) => Date.parse(a.captured_at || 0) - Date.parse(b.captured_at || 0));
      memory.analysisTimelineSnapshots.set(fixtureId, local.slice(-80));
    }
  
    if (!hasSupabase(cfg)) return true;
    try {
      await supaInsertIgnore(cfg, 'analysis_timeline_snapshots', row, 'snapshot_key');
      return true;
    } catch (error) {
      console.warn('AI timeline snapshot persistence skipped', error?.message || error);
      return false;
    }
  }
  
  async function getAnalysisTimelineSnapshots(fixtureId, cfg, limit = 80) {
    const id = Number(fixtureId || 0);
    if (!id) return [];
    if (hasSupabase(cfg)) {
      try {
        return await supaSelectMany(cfg, 'analysis_timeline_snapshots', {
          fixture_id: `eq.${id}`,
        }, {
          limit: Math.max(1, Math.min(120, Number(limit || 80))),
          order: 'captured_at.asc',
        });
      } catch (error) {
        console.warn('AI timeline history read skipped', error?.message || error);
      }
    }
    return (memory.analysisTimelineSnapshots.get(id) || []).slice(-Math.max(1, Math.min(120, Number(limit || 80))));
  }
  
  async function loadFixtureAiTimeline({ fixtureId, match = {}, events = [], cfg } = {}) {
    const id = Number(fixtureId || 0);
    if (!id) return buildAiTimeline({ match, events });
    const [snapshotRows, modelPrediction, oddsSnapshots] = await Promise.all([
      getAnalysisTimelineSnapshots(id, cfg, 80),
      loadModelPredictionForFixture(id, cfg).catch(() => null),
      getOddsSnapshots(id, cfg, 20).catch(() => []),
    ]);
    return buildAiTimeline({
      snapshotRows,
      modelPrediction,
      oddsSnapshots,
      events,
      match,
    });
  }

  return {
    captureAnalysisTimelineSnapshot,
    getAnalysisTimelineSnapshots,
    loadFixtureAiTimeline
  };
}
