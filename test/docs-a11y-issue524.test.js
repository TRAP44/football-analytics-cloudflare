import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');

test('root documentation contains only active entry points',()=>{
  const rootMarkdown=readdirSync(root).filter(name=>name.endsWith('.md')).sort();
  assert.deepEqual(rootMarkdown,[
    'INSTALL_RU.md',
    'README.md',
    'README_CLOUDFLARE_RU.md',
  ]);

  for(const path of [
    'docs/MATCHRADAR_BRAND_SPEC_RU.md',
    'docs/MEDIA_LAUNCH_RU.md',
    'docs/PRIMARY_TELEGRAM_BOT_MIGRATION_PREP_RU.md',
    'docs/QA_RELEASE_CHECKLIST_RU.md',
    'docs/archive/TELEGRAM_CHANNEL_PUBLISHER_MVP_RU.md',
    'docs/archive/architecture-phase2-backend-boundaries.md',
    'docs/archive/architecture-phase3-frontend-boundaries.md',
    'docs/archive/phase4-product-ux-audit.md',
  ]) assert.equal(existsSync(resolve(root,path)),true,path);
});

test('Supabase README documents exact v6.19 baseline boundary',()=>{
  const readme=readFileSync(resolve(root,'supabase/README.md'),'utf8');
  for(const version of [
    'v6_9','v6_10','v6_11','v6_11_1','v6_12','v6_13','v6_14',
    'v6_15','v6_16','v6_17','v6_18','v6_18_1','v6_19','v6_19_1',
  ]) assert.ok(readme.includes(`supabase_migration_${version}.sql`),version);
  assert.ok(readme.includes('через v6.19.1 включительно'));
  assert.ok(readme.includes('supabase_migration_v6_29_1.sql'));
});

test('custom tabs expose semantics, keyboard navigation and visible focus',()=>{
  for(const surface of ['public/index.html','public/admin.html']){
    const html=readFileSync(resolve(root,surface),'utf8');
    assert.match(html,/class="tournament-tabs" role="tablist"/);
    assert.match(html,/id="tournament-tab-matches"[^>]+role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"/);
    assert.match(html,/id="tournament-tab-table"[^>]+role="tab"[^>]+aria-selected="false"[^>]+tabindex="-1"/);
    assert.match(html,/id="team-tab-overview"[^>]+role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"/);
    assert.match(html,/role="tabpanel"[^>]+aria-labelledby="team-tab-/);
  }

  const app=readFileSync(resolve(root,'public/app.js'),'utf8');
  assert.match(app,/\['ArrowRight', 'ArrowLeft', 'Home', 'End'\]/);
  assert.match(app,/btn\.setAttribute\('aria-selected', active \? 'true' : 'false'\)/);
  assert.match(app,/btn\.tabIndex = active \? 0 : -1/);
  assert.match(app,/panel\.setAttribute\('role', 'tabpanel'\)/);

  const styles=readFileSync(resolve(root,'public/styles.css'),'utf8');
  assert.match(styles,/button:focus-visible/);
  assert.match(styles,/\.tournament-tab:focus-visible/);
  assert.match(styles,/\.team-tab:focus-visible/);
});
