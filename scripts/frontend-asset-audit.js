import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

export const IMMUTABLE_FRONTEND_ASSETS=Object.freeze([
  '/app.js',
  '/styles.css',
  '/styles/public-shell.css',
  '/styles/premium-ui.css',
]);

const REQUIRED_SURFACE_ASSETS=Object.freeze({
  public:Object.freeze([
    '/app.js',
    '/styles.css',
    '/styles/public-shell.css',
    '/styles/premium-ui.css',
  ]),
  admin:Object.freeze([
    '/app.js',
    '/styles.css',
    '/styles/public-shell.css',
  ]),
  status:Object.freeze([
    '/status.js',
  ]),
});

const HTML_REVALIDATE_PATHS=Object.freeze([
  '/index.html',
  '/admin.html',
  '/status.html',
  '/privacy.html',
  '/terms.html',
  '/',
]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
}

function parseAttributes(tag) {
  const out={};
  const source=typeof tag==='string' ? tag : '';
  const open=/^<\s*[^\s/>]+/.exec(source)?.[0] || '';
  const rest=source.slice(open.length);
  const re=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let match;
  while ((match=re.exec(rest))) {
    const key=String(match[1] || '').toLowerCase();
    if (!key || Object.hasOwn(out,key)) continue;
    out[key]=match[2] ?? match[3] ?? match[4] ?? '';
  }
  return out;
}

function tags(html,name) {
  if (typeof html!=='string') return [];
  const re=new RegExp('<'+name+'\\b[^>]*>','gi');
  return html.match(re) || [];
}

export function surfaceRevisionValues(html) {
  return tags(html,'meta')
    .map(parseAttributes)
    .filter(attrs=>attrs.name==='frontend-asset-revision')
    .map(attrs=>attrs.content || '');
}

export function localAssetReferences(html) {
  const out=[];
  for (const [tagName,attribute] of [['script','src'],['link','href']]) {
    for (const tag of tags(html,tagName)) {
      const attrs=parseAttributes(tag);
      const raw=attrs[attribute];
      if (typeof raw!=='string' || !raw.startsWith('/')) continue;
      let url;
      try {
        url=new URL(raw,'https://matchradar.invalid');
      } catch {
        out.push({tagName,raw,path:'',revision:'',queryKeys:[],attrs});
        continue;
      }
      out.push({
        tagName,
        raw,
        path:url.pathname,
        revision:url.searchParams.get('v') || '',
        revisionCount:url.searchParams.getAll('v').length,
        queryKeys:[...url.searchParams.keys()],
        hash:url.hash,
        attrs,
      });
    }
  }
  return out;
}

export function parseHeadersPolicy(source) {
  const sections=new Map();
  let current='';
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    if (!/^\s/.test(rawLine)) {
      current=rawLine.trim();
      if (!sections.has(current)) sections.set(current,[]);
      continue;
    }
    if (!current) continue;
    const line=rawLine.trim();
    const separator=line.indexOf(':');
    if (separator<=0) continue;
    sections.get(current).push({
      name:line.slice(0,separator).trim().toLowerCase(),
      value:line.slice(separator+1).trim(),
    });
  }
  return sections;
}

function cacheControlDirectives(value) {
  const out=new Map();
  for (const token of String(value || '').split(',')) {
    const part=token.trim().toLowerCase();
    if (!part) continue;
    const index=part.indexOf('=');
    if (index<0) out.set(part,true);
    else out.set(part.slice(0,index).trim(),part.slice(index+1).trim());
  }
  return out;
}

function cacheControlFor(sections,path) {
  const blocks=sections.get(path) || [];
  return blocks
    .filter(entry=>entry.name==='cache-control')
    .map(entry=>entry.value);
}

function hasOnlyRevisionQuery(ref,revision) {
  return ref.revision===revision
    && ref.revisionCount===1
    && ref.queryKeys.length===1
    && ref.queryKeys[0]==='v'
    && !ref.hash;
}

function requireCachePolicy(findings,sections,path,mode) {
  const values=cacheControlFor(sections,path);
  if (values.length!==1) {
    findings.push(path+' must define exactly one Cache-Control header');
    return;
  }
  const directives=cacheControlDirectives(values[0]);
  if (mode==='immutable') {
    if (
      directives.get('public')!==true
      || directives.get('max-age')!=='31536000'
      || directives.get('immutable')!==true
      || directives.has('no-cache')
      || directives.has('must-revalidate')
    ) {
      findings.push(path+' must use public max-age=31536000 immutable caching');
    }
    return;
  }
  if (mode==='revalidate') {
    if (
      directives.get('public')!==true
      || directives.get('max-age')!=='0'
      || directives.get('must-revalidate')!==true
      || directives.has('immutable')
    ) {
      findings.push(path+' must use public max-age=0 must-revalidate caching');
    }
    return;
  }
  if (
    directives.get('no-cache')!==true
    || directives.get('max-age')!=='0'
    || directives.get('must-revalidate')!==true
    || directives.has('immutable')
  ) {
    findings.push(path+' must use no-cache max-age=0 must-revalidate caching');
  }
}

export function auditFrontendAssetContract({
  packageVersion,
  runtimeRevision,
  surfaces,
  headers,
} = {}) {
  const findings=[];
  const version=typeof packageVersion==='string' ? packageVersion.trim() : '';
  const revision=typeof runtimeRevision==='string' ? runtimeRevision.trim() : '';
  const expectedRevisionPattern=version
    ? new RegExp('^'+escapeRegex(version)+'-launch\\d+$')
    : null;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    findings.push('package version must be exact numeric semver');
  }
  if (!revision || !expectedRevisionPattern?.test(revision)) {
    findings.push('frontend asset revision must be <package.version>-launch<number>');
  }

  const surfaceMap=surfaces && typeof surfaces==='object' && !Array.isArray(surfaces)
    ? surfaces
    : {};

  for (const name of ['public','admin']) {
    const html=typeof surfaceMap[name]==='string' ? surfaceMap[name] : '';
    const revisions=surfaceRevisionValues(html);
    if (revisions.length!==1) {
      findings.push(name+' surface must declare exactly one frontend asset revision meta');
    } else if (revisions[0]!==revision) {
      findings.push(name+' surface revision must match runtime revision');
    }
  }

  for (const [name,requiredPaths] of Object.entries(REQUIRED_SURFACE_ASSETS)) {
    const html=typeof surfaceMap[name]==='string' ? surfaceMap[name] : '';
    const refs=localAssetReferences(html);
    for (const assetPath of requiredPaths) {
      const matching=refs.filter(ref=>ref.path===assetPath);
      if (matching.length!==1) {
        findings.push(name+' surface must reference '+assetPath+' exactly once');
        continue;
      }
      if (!hasOnlyRevisionQuery(matching[0],revision)) {
        findings.push(name+' '+assetPath+' must use only the current revision token');
      }
      if (assetPath.endsWith('.js') && matching[0].attrs.type!=='module') {
        findings.push(name+' '+assetPath+' must load as a module script');
      }
    }

    for (const ref of refs) {
      if (
        IMMUTABLE_FRONTEND_ASSETS.includes(ref.path)
        && !hasOnlyRevisionQuery(ref,revision)
      ) {
        findings.push(name+' immutable asset '+ref.path+' is not revision-safe');
      }
    }
  }

  const sections=parseHeadersPolicy(headers);
  for (const assetPath of IMMUTABLE_FRONTEND_ASSETS) {
    requireCachePolicy(findings,sections,assetPath,'immutable');
  }
  requireCachePolicy(findings,sections,'/modules/*','revalidate');
  requireCachePolicy(findings,sections,'/status.js','revalidate');
  for (const htmlPath of HTML_REVALIDATE_PATHS) {
    requireCachePolicy(findings,sections,htmlPath,'html');
  }

  return [...new Set(findings)].sort();
}

export function auditFrontendAssetFiles({
  packagePath='package.json',
  publicHtmlPath='public/index.html',
  adminHtmlPath='public/admin.html',
  statusHtmlPath='public/status.html',
  headersPath='public/_headers',
} = {}) {
  const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
  return auditFrontendAssetContract({
    packageVersion:pkg.version,
    runtimeRevision:FRONTEND_ASSET_REVISION,
    surfaces:{
      public:fs.readFileSync(publicHtmlPath,'utf8'),
      admin:fs.readFileSync(adminHtmlPath,'utf8'),
      status:fs.readFileSync(statusHtmlPath,'utf8'),
    },
    headers:fs.readFileSync(headersPath,'utf8'),
  });
}

const invokedPath=process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url===invokedPath) {
  const findings=auditFrontendAssetFiles();
  if (findings.length) {
    process.stderr.write(findings.map(item=>'- '+item).join('\n')+'\n');
    process.exitCode=1;
  } else {
    process.stdout.write('Frontend asset contract: OK\n');
  }
}
