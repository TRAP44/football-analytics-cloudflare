import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('removed model honesty strip has no renderer, mount, controls or styles',()=>{
 const view=readFileSync('public/modules/match-center-view.js','utf8');
 const css=readFileSync('public/styles/premium-ui.css','utf8');
 assert.doesNotMatch(view,/Честность модели|matchCenterTrackRecordHtml|data-center-track-record|mr-ai-proof/);
 assert.doesNotMatch(css,/mr-ai-proof/);
});
