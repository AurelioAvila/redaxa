import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository, demoReport } from "./repository-scanner.js";
import {scanFullRepository,type Progress} from './repository-full.js';
import {verifyRepositoryAccess} from './repository-access.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2"
};

let repositoryScanBusy = false;
let lastRepositoryScan = 0;
let repositoryProgress:Progress={stage:'Ready',checked:0,findings:0};
let repositoryProgressId='';
createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if(pathname==='/api/repository-config'){
    response.writeHead(200,securityHeaders('application/json'));
    response.end(JSON.stringify({available:process.env.REPO_SCAN_PREVIEW==='1',designReview:process.env.REPO_SCAN_PREVIEW==='1'&&process.env.REPO_SCAN_DESIGN_REVIEW==='1',requiresPlan:'pro'}));return;
  }
  if(pathname==='/api/repository-progress'){
    const origin=`http://127.0.0.1:${process.env.PORT??4173}`;
    if(process.env.REPO_SCAN_PREVIEW!=='1'||request.method!=='GET'||request.headers.host!==new URL(origin).host||request.headers['x-redaxa-preview']!=='1'||request.headers.origin&&request.headers.origin!==origin){response.writeHead(403,securityHeaders('application/json'));response.end('{}');return;}
    if(!repositoryProgressId||request.headers['x-redaxa-scan']!==repositoryProgressId){response.writeHead(404,securityHeaders('application/json'));response.end('{}');return;}
    response.writeHead(200,securityHeaders('application/json'));response.end(JSON.stringify(repositoryProgress));return;
  }

  // Development-only desktop transport to the same official API used by packaged Redaxa.
  // No production CORS changes, shared credentials, cookie forwarding or auth bypass.
  if (pathname.startsWith('/api/desktop-preview/')) {
    const origin = `http://127.0.0.1:${process.env.PORT ?? 4173}`;
    const target = pathname.slice('/api/desktop-preview'.length);
    const allowed = /^\/api\/(?:auth-config|account|scan|billing|team|auth\/(?:session|signin|signup|signout|recover|callback))$/;
    const reject = (code:number,message:string) => {response.writeHead(code,securityHeaders('application/json'));response.end(JSON.stringify({error:message}));};
    if(process.env.REPO_SCAN_PREVIEW !== '1' || request.headers.host !== new URL(origin).host || request.headers['x-redaxa-desktop'] !== '1' || request.headers.origin && request.headers.origin !== origin || !allowed.test(target) || !['GET','POST'].includes(request.method ?? '')) {reject(403,'Desktop preview request denied.');return;}
    try {
      let body='';for await(const chunk of request) {body+=chunk;if(Buffer.byteLength(body)>100_000) throw new Error('size');}
      const headers:Record<string,string>={'Content-Type':'application/json'};
      for(const name of ['authorization','x-refresh-token']) {const value=request.headers[name];if(typeof value==='string') headers[name]=value;}
      const query=new URL(request.url!,origin).search;
      const upstream=await fetch('https://promptshield-beta.vercel.app'+target+query,{method:request.method,headers,body:request.method==='POST'?body:undefined,redirect:'error',signal:AbortSignal.timeout(20_000)});
      const reply = await upstream.text();
      // Opt-in local diagnostics: never print identities, tokens or response bodies.
      if(process.env.REDAXA_ACCOUNT_DEBUG==='1' && target==='/api/account' && !query){
        let verified=false;try{verified=typeof JSON.parse(reply).active==='boolean';}catch{}
        console.info('Desktop account lookup', JSON.stringify({httpStatus:upstream.status,verifiedState:verified}));
      }
      response.writeHead(upstream.status,securityHeaders('application/json'));response.end(reply);
    } catch {reject(502,'Unable to reach Redaxa account services. Please try again.');}
    return;
  }

  if (pathname === '/api/repository-scan') {
    const reply = (code: number, data: unknown) => { response.writeHead(code, securityHeaders('application/json')); response.end(JSON.stringify(data)); };
    if (process.env.REPO_SCAN_PREVIEW !== '1') { reply(404, {error:'Repository preview is not enabled.'}); return; }
    const allowedOrigin = `http://127.0.0.1:${process.env.PORT ?? 4173}`;
    if(request.method !== 'POST' || request.headers['x-redaxa-preview'] !== '1' || request.headers.origin && request.headers.origin !== allowedOrigin || request.headers.host !== new URL(allowedOrigin).host) { reply(403,{error:'Use the local Redaxa preview.'}); return; }
    if(repositoryScanBusy) {reply(409,{error:'A repository check is already running.'});return;}
    let body = '';
    try { for await(const chunk of request) {body += chunk; if(Buffer.byteLength(body)>2048) throw new Error('Request too large.');} }
    catch {reply(400,{error:'Invalid scan request.'});return;}
    let input: {url?:string;demo?:boolean;includeHistory?:boolean};
    try {input=JSON.parse(body);if(!input || typeof input !== 'object') throw new Error();} catch {reply(400,{error:'Invalid scan request.'});return;}
    if(input.demo === true) {reply(200,demoReport(true));return;}
    if(typeof input.url !== 'string') {reply(400,{error:'Enter a GitHub repository URL.'});return;}
    const designReview=process.env.REPO_SCAN_DESIGN_REVIEW==='1';
    if(!designReview&&!await verifyRepositoryAccess(request.headers.authorization)){reply(403,{error:'Repository checks require an active Redaxa Pro or Business subscription. Sign in with your subscribed account.',code:'PRO_REQUIRED'});return;}
    // Recheck after the async account lookup so concurrent requests cannot start two clones.
    if(repositoryScanBusy){reply(409,{error:'A repository check is already running.'});return;}
    const scanId=request.headers['x-redaxa-scan'];
    if(typeof scanId!=='string'||!/^[a-f0-9-]{36}$/.test(scanId)){reply(400,{error:'Start a new check from the app.'});return;}
    if(Date.now()-lastRepositoryScan<30_000) {reply(429,{error:'Please wait 30 seconds between GitHub scans.'});return;}
    const abort = new AbortController();response.on('close',()=>abort.abort());
    repositoryScanBusy=true;lastRepositoryScan=Date.now();repositoryProgressId=scanId;
    repositoryProgress={stage:'Starting complete repository check…',checked:0,findings:0};
    try {reply(200,await scanFullRepository(input.url,abort.signal,true,p=>{repositoryProgress=p;},input.includeHistory===true));}
    catch(e) {reply(400,{error:e instanceof Error && !/fetch|abort|timeout/i.test(e.message) ? e.message : 'The scan timed out or could not connect. Please try again.'});}
    finally {repositoryScanBusy=false;}
    return;
  }

  if (pathname === "/api/auth-config") {
    const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
    response.writeHead(200, securityHeaders("application/json; charset=utf-8"));
    response.end(JSON.stringify({ configured }));
    return;
  }

  if (pathname === "/health") {
    response.writeHead(200, securityHeaders("application/json; charset=utf-8"));
    response.end(JSON.stringify({ status: "ok", service: "redaxa", promptStorage: "none" }));
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // Development server serves UI assets only, never source, credentials or Git metadata.
  if (!/^(?:[a-zA-Z0-9_-]+\.(?:html|css|webmanifest)|dist\/(?:themes|auth|dashboard|desktop|pwa|landing|growth|repository-ui|repository-report|repository-example)\.js|browser-extension\/(?:popup\.(?:html|css|js)|config\.js|icons\/48\.png)|outputs\/[a-zA-Z0-9_.-]+\.(?:svg|png|webp|woff2)|service-worker\.js)$/.test(relativePath)) {
    response.writeHead(404, securityHeaders('text/plain'));response.end('Not found');return;
  }
  const filePath = resolve(root, relativePath);
  const insideRoot = filePath.startsWith(root + pathSeparator());

  if (!insideRoot || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }

  response.writeHead(200, securityHeaders(mimeTypes[extname(filePath)] ?? "application/octet-stream"));
  response.end(readFileSync(filePath));
}).listen(Number(process.env.PORT ?? 4173), "127.0.0.1");

function pathSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}
