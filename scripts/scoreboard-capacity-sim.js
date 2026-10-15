#!/usr/bin/env node
// Изолированный замер живого табло (Issue #921): сколько вызовов Telegram, записей
// в Supabase и запусков cron нужно, чтобы 1000 / 10000 болельщиков получили табло
// и правку после гола. Всё в памяти, сеть не используется.
// Симулятор не доказывает реальную пропускную способность Telegram — он считает
// наши операции и задержку очереди при лимите сообщений на запуск.
//
//   node scripts/scoreboard-capacity-sim.js [1000 10000 ...]
import { createScoreboardHarness, fixtureRow } from './scoreboard-harness.js';

const RUN_EVERY_MS = 5 * 60_000; // cron раз в 5 минут

async function simulate(audience) {
  const favorites = Array.from({ length: audience }, (_, i) => ({ telegram_id: 100000 + i, team_id: 596 }));
  const h = createScoreboardHarness({ favorites });
  const start = h.now();
  const phase = async (label, row, done) => {
    const before = { ...h.counters };
    let runs = 0;
    let maxWait = 0;
    while (!done() && runs < 100) {
      h.setFixtures([row]);
      const summary = await h.run();
      runs += 1;
      maxWait = Math.max(maxWait, summary.oldestWaitSec || 0);
      if (!done()) h.tick(RUN_EVERY_MS);
    }
    const state = JSON.stringify(h.store.get('scoreboard:7:v1') || {}).length;
    return {
      phase: label,
      runs,
      minutesToFinish: Math.round((runs - 1) * RUN_EVERY_MS / 60_000),
      telegramCalls: h.counters.telegram - before.telegram,
      dbWrites: h.counters.dbWrites - before.dbWrites,
      dbKbWritten: Math.round((h.counters.dbBytes - before.dbBytes) / 1024),
      favoritePageReads: h.counters.favoriteReads - before.favoriteReads,
      stateKb: Math.round(state / 1024),
      oldestWaitSec: maxWait,
    };
  };
  const boards = () => Object.values(h.store.get('scoreboard:7:v1')?.users || {});
  const first = await phase('first boards', fixtureRow({ elapsed: 5 }), () => h.sent.length >= audience);
  let edits = 0;
  const editsDone = () => edits >= audience;
  const goal = fixtureRow({ elapsed: 30, home: 1 });
  const before = h.counters.telegram;
  const second = await phase('goal edit', goal, () => { edits = h.counters.telegram - before; return editsDone(); });
  return { audience, totalMinutes: Math.round((h.now() - start) / 60_000), boards: boards().length, phases: [first, second] };
}

const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
for (const audience of sizes.length ? sizes : [1000, 10000]) {
  const result = await simulate(audience);
  console.log(`\n=== ${audience} получателей (boards: ${result.boards}) ===`);
  console.table(result.phases);
}
