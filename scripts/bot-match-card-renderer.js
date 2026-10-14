// Node-only background renderer. Never imported by the Cloudflare Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {buildBotMatchCardSvg,botCardRows,BOT_CARD_MAX_BYTES} from '../src/bot-match-card.js';

let initialized;
let font;

async function initialize() {
  if (!initialized) initialized=(async()=>{
    const root=path.dirname(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm')));
    await initWasm(await fs.readFile(path.join(root,'index_bg.wasm')));
    font=new Uint8Array(await fs.readFile(new URL('./assets/bot-cards/DejaVuSans.ttf',import.meta.url)));
  })().catch(error=>{initialized=null;throw error;});
  await initialized;
}

export async function fetchBotCardLogo(teamId, fetchImpl=fetch) {
  if (!Number.isSafeInteger(teamId) || teamId<=0) return null;
  // Canonical public logo URL only. Ignore provider/user URLs and disallow redirects.
  const response=await fetchImpl(`https://media.api-sports.io/football/teams/${teamId}.png`,{
    redirect:'error',signal:AbortSignal.timeout(2500),
  });
  if (!response.ok || !response.body) return null;
  const reader=response.body.getReader();
  const chunks=[];
  let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.length;
      if (size>128000) {await reader.cancel();return null;}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const png=Buffer.concat(chunks);
  if (png.length<24 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
  // Bound decoded image dimensions too, before handing bytes to the rasterizer.
  if (png.readUInt32BE(16)>512 || png.readUInt32BE(20)>512) return null;
  return 'data:image/png;base64,'+png.toString('base64');
}

export async function renderBotMatchCard(matches,{liveOnly=false,generatedAt=Date.now(),fetchLogo=fetchBotCardLogo}={}) {
  await initialize();
  const ids=[...new Set(botCardRows(matches).slice(0,4).flatMap(m=>[m.homeId,m.awayId]).filter(Boolean))];
  const logos=new Map();
  // At most 8 bounded logo reads, four in parallel; no provider API calls.
  for (let i=0;i<ids.length;i+=4) {
    await Promise.all(ids.slice(i,i+4).map(async id=>{
      const image=await fetchLogo(id).catch(()=>null);
      if (image) logos.set(id,image);
    }));
  }
  const renderer=new Resvg(buildBotMatchCardSvg(matches,{liveOnly,logos,generatedAt}),{
    font:{fontBuffers:[font],loadSystemFonts:false,defaultFontFamily:'DejaVu Sans'},
  });
  try {
    const png=renderer.render();
    try {
      const bytes=png.asPng();
      if (bytes.length>BOT_CARD_MAX_BYTES) throw new Error('bot_card_size_limit');
      return Buffer.from(bytes).toString('base64');
    } finally {png.free();}
  } finally {renderer.free();}
}
