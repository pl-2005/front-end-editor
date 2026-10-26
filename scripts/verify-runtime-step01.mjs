// Run with the existing local Vite server (its config reads repository-root .env)
// and web-access CDP Proxy. Uses only a new tab and an ephemeral local HTTP server;
// no project, database, object storage, or existing browser tab is modified.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const vite = process.env.STEP01_VITE_URL || 'http://localhost:5173'
const proxy = process.env.WEB_ACCESS_PROXY_URL || 'http://localhost:3456'
const root = new URL('../', import.meta.url)
if (!existsSync(new URL('.env', root))) throw Error('Repository-root .env is required')
const pages = new Map()
const server = createServer((request, response) => {
  const page = pages.get(request.url)
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  if (page?.csp) response.setHeader('Content-Security-Policy', page.csp)
  response.end(page?.code || '<!doctype html><title>Step 01 browser acceptance</title><body></body>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let target
const results = []
async function call(path, body) {
  const response = await fetch(proxy + path, {
    ...(body === undefined ? {} : { method: 'POST', body }),
    signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok || result.error) throw Error(result.error || `Proxy HTTP ${response.status}`)
  return result
}
async function evaluate(code) {
  const result = await call(`/eval?target=${target}`, code)
  return result.value
}
async function activateTestTab(targetId) {
  // Proxy creates background tabs and exposes no activation endpoint. Activate
  // only our new target so Chromium actually advances CSS animations and rAF.
  const socket = new WebSocket(process.env.STEP01_BROWSER_WS || 'ws://127.0.0.1:9222/devtools/browser')
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Browser WebSocket connection timed out')), 5000)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error) }, { once: true })
    })
    let sequence = 0
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence
      const receive = ({ data }) => {
        const response = JSON.parse(data)
        if (response.id !== id) return
        clearTimeout(timer)
        socket.removeEventListener('message', receive)
        response.error ? reject(Error(response.error.message)) : resolve(response.result)
      }
      const timer = setTimeout(() => {
        socket.removeEventListener('message', receive)
        reject(Error('Test tab activation timed out: ' + method))
      }, 5000)
      socket.addEventListener('message', receive)
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    await send('Target.activateTarget', { targetId })
    const attached = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.bringToFront', {}, attached.sessionId)
  } finally {
    socket.close()
  }
}
async function check(name, expression) {
  const value = await evaluate(expression)
  if (value !== true) throw Error(`${name}: ${JSON.stringify(value)}`)
  results.push(name)
  console.log(`PASS ${name}`)
}
async function prepare(name, source, csp) {
  const projected = await evaluate(`(async()=>{
    const {RuntimeProjection}=await import(${JSON.stringify(vite + '/src/editor/visual/canvas/runtimeProjection.ts')});
    const source=${JSON.stringify(source)};
    const projection=new RuntimeProjection();
    const file={id:${JSON.stringify(name)},path:'/index.html',language:'html',content:{toString:()=>source},deletedAt:null};
    const code=projection.project([file],{'/index.html':{code:source}})['/index.html'].code;
    const registry=projection.registries.get(file.id);
    window.stepCases??={};
    window.stepCases[file.id]={projection,registry,messages:[],hello:0,frame:null,port:null};
    return {code,generation:registry?.generation};
  })()`)
  pages.set('/' + name, { code: projected.code, csp })
  await evaluate(`(()=>{
    const state=window.stepCases[${JSON.stringify(name)}];
    state.listener=event=>{
      if(event.source!==state.frame?.contentWindow||event.data?.type!=='runtime-hello')return;
      state.hello++;
      const channel=new MessageChannel();state.port=channel.port1;
      channel.port1.onmessage=event=>state.messages.push(event.data);channel.port1.start();
      state.frame.contentWindow.postMessage({type:'runtime-connect',capability:state.projection.capability,fileId:${JSON.stringify(name)},generation:state.registry.generation},'*',[channel.port2]);
    };
    window.addEventListener('message',state.listener);
    const frame=document.createElement('iframe');frame.width='640';frame.height='240';state.frame=frame;
    frame.src=${JSON.stringify(origin + '/' + name)};document.body.append(frame);
  })()`)
  return projected
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function wait(expression, timeout = 8000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  console.error('Test page diagnostics:', await evaluate(`JSON.stringify({visibility:document.visibilityState,actions:document.querySelector('#react-host .v3-runtime-actions')?.textContent,locations:window.reactCase?.locations.length,inspections:window.reactCase?.inspections.length,messages:window.stepDebugMessages?.slice(-12),frame:document.querySelector('#react-host iframe')?.getBoundingClientRect().toJSON()})`))
  throw Error('Browser condition timed out: ' + expression)
}
const state = (name) => `window.stepCases[${JSON.stringify(name)}]`
try {
  target = (await call('/new', origin + '/harness')).targetId
  if (!target) throw Error('Proxy did not return targetId')
  await activateTestTab(target)
  const source = `<!doctype html><html><head><style>@keyframes move{from{transform:translateX(0)}to{transform:translateX(100px)}}.moving{animation:move 1s linear infinite alternate}body{min-height:1600px}a,button{cursor:pointer}</style></head><body><p id="target">中文😀 &amp; entity</p><input id="input" value="initial"><a id="cursor-link" href="#target">link</a><button id="cursor-button">button</button><span id="cursor-inline" style="cursor:text">inline cursor</span><img id="image" src=/assets/x/><script>
window.token=crypto.randomUUID();window.rectReads=0;
const original=Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect=function(){window.rectReads++;return original.call(this)};
</script></body></html>`
  await prepare('basic', source)
  const s = state('basic')
  await wait(`${s}.messages.some(m=>m.type==='ready')`)
  await check('unquoted trailing slash preserves image attribute', `${s}.frame.contentDocument.querySelector('#image').getAttribute('src')==='/assets/x/'`)
  await check('tool material removed and authoritative source unchanged', `(()=>{const s=${s};return s.registry.source===${JSON.stringify(source)}&&!s.frame.contentDocument.querySelector('[ '+s.projection.marker+' ]')&&!s.frame.contentDocument.documentElement.outerHTML.includes(s.projection.capability)})()`)
  await evaluate(`(()=>{const s=${s},w=s.frame.contentWindow;w.document.querySelector('#input').value='保持输入';w.scrollTo(0,120);s.token=w.token;s.port.postMessage({type:'mode',active:true,modeRevision:1})})()`)
  await wait(`${s}.messages.some(m=>m.type==='mode-ready'&&m.modeRevision===1)`)
  await check('inspection keeps a default cursor over inputs, links, buttons and inline cursors', `(()=>{const w=${s}.frame.contentWindow;return ['input','cursor-link','cursor-button','cursor-inline'].every(id=>w.getComputedStyle(w.document.getElementById(id)).cursor==='default')})()`)
  await evaluate(`${s}.frame.contentDocument.querySelector('#target').click()`)
  await wait(`${s}.messages.some(m=>m.type==='select')`)
  await check('static source is candidate and never write authority', `${s}.messages.filter(m=>m.type==='select').at(-1).sourceStatus==='candidate'`)
  await evaluate(`(async()=>{const s=${s},w=s.frame.contentWindow;await w.document.fonts.ready;await new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));s.still=s.messages.filter(m=>m.type==='select').length;s.reads=w.rectReads;s.sampleStart=performance.now();s.sampleFrames=0;s.sampleActive=true;const count=()=>{if(!s.sampleActive)return;s.sampleFrames++;w.requestAnimationFrame(count)};w.requestAnimationFrame(count)})()`)
  await sleep(350)
  await check('stationary target geometry messages are deduplicated', `${s}.messages.filter(m=>m.type==='select').length===${s}.still`)
  const sampling = await evaluate(`(()=>{const s=${s};s.sampleActive=false;return s.sampling={stationaryWaitMs:350,elapsedMs:Math.round(performance.now()-s.sampleStart),targetSlots:2,frames:s.sampleFrames,rectReads:s.frame.contentWindow.rectReads-s.reads,selectionGeometryMessages:s.messages.filter(m=>m.type==='select').length-s.still}})()`)
  await check('active geometry sampler reads a bounded target set', `(()=>{const m=${s}.sampling;return m.frames>0&&m.rectReads>0&&m.rectReads<=2*(m.frames+2)})()`)
  await evaluate(`${s}.frame.contentDocument.querySelector('#target').classList.add('moving')`)
  await sleep(400)
  await check('CSS transform animation updates target geometry', `new Set(${s}.messages.filter(m=>m.type==='select').map(m=>m.rect.x)).size>2`)
  await evaluate(`(()=>{const s=${s},d=s.frame.contentDocument,p=d.querySelector('#target');p.classList.remove('moving');s.beforeImage=p.getBoundingClientRect().y;const image=d.createElement('img');image.id='delayed-image';image.style.display='block';p.before(image);setTimeout(()=>{image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="72"/>')},80)})()`)
  await wait(`${s}.frame.contentDocument.querySelector('#delayed-image').naturalHeight===72&&${s}.messages.filter(m=>m.type==='select').at(-1).rect.y>${s}.beforeImage+50`)
  await check('delayed image intrinsic size moves selection geometry', `${s}.messages.filter(m=>m.type==='select').at(-1).rect.y>${s}.beforeImage+50`)
  await evaluate(`(async()=>{const s=${s},w=s.frame.contentWindow,p=w.document.querySelector('#target');p.style.width='max-content';p.style.fontFamily='monospace';s.fontBefore=p.getBoundingClientRect().width;const font=new w.FontFace('Step01Delayed','local("Arial")');await font.load();w.document.fonts.add(font);await new Promise(resolve=>setTimeout(resolve,80));p.style.fontFamily='Step01Delayed';s.fontLoaded=font.status==='loaded'})()`)
  await wait(`${s}.messages.filter(m=>m.type==='select').at(-1).rect.width!==${s}.fontBefore`)
  await check('delayed local font loading updates measured selection', `${s}.fontLoaded&&${s}.messages.filter(m=>m.type==='select').at(-1).rect.width!==${s}.fontBefore`)
  await evaluate(`(()=>{const s=${s},d=s.frame.contentDocument;const dynamic=d.createElement('strong');dynamic.id='dynamic';dynamic.textContent='runtime';d.querySelector('#target').append(dynamic);dynamic.click()})()`)
  await wait(`${s}.messages.filter(m=>m.type==='select').at(-1).tag==='strong'`)
  await check('dynamic target does not silently fall back to source ancestor', `(()=>{const m=${s}.messages.filter(m=>m.type==='select').at(-1);return m.sourceStatus==='unmapped'&&m.nodeId===''})()`)
  await evaluate(`${s}.port.postMessage({type:'parent',modeRevision:1})`)
  await wait(`${s}.messages.filter(m=>m.type==='select').at(-1).tag==='p'`)
  await check('explicit parent follows actual DOM relationship', `${s}.messages.filter(m=>m.type==='select').at(-1).sourceStatus==='candidate'`)
  await evaluate(`${s}.frame.contentDocument.querySelector('#target').remove()`)
  await wait(`${s}.messages.some(m=>m.type==='clear-selection'&&m.modeRevision===1)`)
  await check('removed target clears selection instead of leaving stale geometry', `${s}.messages.some(m=>m.type==='clear-selection'&&m.modeRevision===1)`)
  await evaluate(`(()=>{const s=${s};s.scrollBeforeMode=s.frame.contentWindow.scrollY;s.port.postMessage({type:'mode',active:false,modeRevision:2});s.port.postMessage({type:'mode',active:true,modeRevision:3});s.port.postMessage({type:'mode',active:false,modeRevision:4});s.port.postMessage({type:'mode',active:true,modeRevision:3})})()`)
  await wait(`${s}.messages.some(m=>m.type==='mode-ready'&&m.modeRevision===4)`)
  await sleep(80)
  await evaluate(`${s}.stoppedReads=${s}.frame.contentWindow.rectReads`)
  await sleep(250)
  await check('inactive sampler stops and rejects older mode commands', `${s}.frame.contentWindow.rectReads===${s}.stoppedReads&&!${s}.messages.some(m=>m.modeRevision===3&&m.type==='select')`)
  sampling.inactiveIntervalMs = 250
  sampling.inactiveRectReads = await evaluate(`${s}.frame.contentWindow.rectReads-${s}.stoppedReads`)
  await check('mode switches preserve frame, input, script state and scroll', `(()=>{const s=${s},w=s.frame.contentWindow;return s.frame.isConnected&&w.token===s.token&&w.document.querySelector('#input').value==='保持输入'&&w.scrollY===s.scrollBeforeMode})()`)
  await check('run mode restores page cursors and removes the inspection sheet', `(()=>{const w=${s}.frame.contentWindow;return w.getComputedStyle(w.document.getElementById('cursor-link')).cursor==='pointer'&&w.getComputedStyle(w.document.getElementById('cursor-button')).cursor==='pointer'&&w.getComputedStyle(w.document.getElementById('cursor-inline')).cursor==='text'&&w.document.adoptedStyleSheets.length===0})()`)

  for (const [name, mutation, expected] of [
    ['replacement', `const p=document.querySelector('#target');p.replaceWith(p.cloneNode(true))`, 'candidate'],
    ['rebuilt', `document.body.innerHTML=document.body.innerHTML`, 'candidate'],
    ['duplicate', `const p=document.querySelector('#target');p.after(p.cloneNode(true))`, 'ambiguous'],
  ]) {
    await prepare(name, `<!doctype html><html><head></head><body><p id="target">target</p><script>${mutation}</script></body></html>`)
    const s = state(name)
    await wait(`${s}.messages.some(m=>m.type==='ready')`)
    await evaluate(`${s}.port.postMessage({type:'mode',active:true,modeRevision:1})`)
    await wait(`${s}.messages.some(m=>m.type==='mode-ready')`)
    await evaluate(`${s}.frame.contentDocument.querySelector('#target').click()`)
    await wait(`${s}.messages.some(m=>m.type==='select')`)
    await check(`initialization ${name} is conservatively ${expected}`, `${s}.messages.filter(m=>m.type==='select').at(-1).sourceStatus===${JSON.stringify(expected)}`)
  }
  await prepare('meta-csp', '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head><body><p>CSP</p></body></html>')
  await prepare('http-csp', '<!doctype html><html><head></head><body><p>CSP</p></body></html>', "script-src 'none'")
  await sleep(600)
  await check('meta CSP blocks inspection without bypass', `${state('meta-csp')}.hello===0&&${state('meta-csp')}.frame.contentDocument.body.textContent==='CSP'`)
  await check('HTTP CSP blocks inspection while retaining page', `${state('http-csp')}.hello===0&&${state('http-csp')}.frame.contentDocument.body.textContent==='CSP'`)

  // Mount the real React parent against its actual Y document. Sandpack itself
  // is intentionally excluded here: iframe navigation comes from our HTTP host.
  const reactCode = await evaluate(`(async()=>{
    const base=${JSON.stringify(vite)};
    const refresh=(await import(base+'/@react-refresh')).default;
    refresh.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const dependency=async(path,name)=>{const code=await(await fetch(base+path)).text();const match=[...code.matchAll(/from "([^"]+)"/g)].find(match=>match[1].includes('/'+name+'.js?'));if(!match)throw Error('Missing dependency '+name);return import(base+match[1])};
    const React=(await dependency('/src/main.tsx','react')).default;
    const client=(await dependency('/src/main.tsx','react-dom_client')).default;
    const Y=await dependency('/src/collaboration/document.ts','yjs');
    const {RuntimeInspector}=await import(base+'/src/editor/visual/canvas/RuntimeInspector.tsx');
    const {RuntimeProjection}=await import(base+'/src/editor/visual/canvas/runtimeProjection.ts');
    const {readDocument}=await import(base+'/src/collaboration/document.ts');
    await import(base+'/src/editor/visual/canvas/design.css?import');
    window.stepDebugMessages=[];const NativeChannel=window.MessageChannel;window.MessageChannel=class extends NativeChannel{constructor(){super();this.port1.addEventListener('message',event=>window.stepDebugMessages.push(event.data))}};
    const doc=new Y.Doc(),meta=doc.getMap('meta');
    for(const [key,value]of Object.entries({schemaVersion:1,projectId:7,epoch:1,entryFileId:'a'}))meta.set(key,value);
    const sources={a:'<!doctype html><html><head><style>@keyframes move{from{transform:translateX(0)}to{transform:translateX(100px)}}.moving{animation:move 1s linear infinite alternate}body{height:1600px}</style></head><body><p id="react-target">运行 A 中文😀</p><input id="react-input"><script>window.token=crypto.randomUUID()</script></body></html>',b:'<!doctype html><html><head></head><body>代码 B</body></html>'};
    for(const id of ['a','b']){const file=new Y.Map(),content=new Y.Text(sources[id]);for(const [key,value]of Object.entries({id,path:'/'+id+'.html',language:'html',deletedAt:null,content}))file.set(key,value);doc.getMap('files').set(id,file)}
    doc.getArray('fileOrder').push(['a','b']);
    const session={doc,identity:{projectId:7,epoch:1}},projection=new RuntimeProjection();
    const code=projection.project(readDocument(doc,session.identity).files,{})['/a.html'].code;
    const host=document.createElement('div');host.id='react-host';document.body.prepend(host);
    const root=client.createRoot(host),locations=[],inspections=[];
    const state={doc,projection,session,locations,inspections,sources,initialDocument:JSON.stringify(doc.toJSON()),codeActiveId:'b',render:null};window.reactCase=state;
    state.render=active=>root.render(React.createElement(RuntimeInspector,{session,projection,inspecting:active,onLocate:location=>locations.push(location),onInspect:location=>inspections.push(location)},React.createElement('iframe',{title:'React runtime',width:640,height:240,src:${JSON.stringify(origin + '/react-a')}})));
    return code;
  })()`)
  pages.set('/react-a', { code: reactCode })
  pages.set('/plain', { code: '<!doctype html><title>Navigation</title><body>new page</body>' })
  await evaluate('window.reactCase.render(true)')
  await activateTestTab(target)
  await wait(`document.querySelector('#react-host .v3-runtime-actions')?.textContent.includes('悬停检查')`)
  await evaluate(`(()=>{const c=window.reactCase;c.frame=document.querySelector('#react-host iframe');const d=c.frame.contentDocument;c.token=c.frame.contentWindow.token;d.querySelector('#react-input').value='state';c.frame.contentWindow.scrollTo(0,90);d.querySelector('#react-target').click()})()`)
  await wait(`!!document.querySelector('#react-host .v3-selection')`)
  await check('React parent locates runtime A while code file is B', `window.reactCase.codeActiveId==='b'&&window.reactCase.locations.at(-1).fileId==='a'&&window.reactCase.locations.at(-1).source.includes('运行 A 中文😀')`)
  await check('React inspector visibly identifies the actual running file', `document.querySelector('#react-host .v3-runtime-actions').textContent.includes('当前检查：/a.html')`)
  for (const [name, top, height] of [['top', 0, 24], ['bottom', 212, 24], ['full-height', 0, 240]]) {
    await evaluate(`(()=>{const c=window.reactCase,w=c.frame.contentWindow,p=w.document.querySelector('#react-target');w.scrollTo(0,0);p.style.cssText='position:fixed;left:20px;top:${top}px;height:${height}px;width:140px;margin:0';p.dispatchEvent(new w.PointerEvent('pointermove',{bubbles:true}))})()`)
    await wait(`(()=>{const label=document.querySelector('.v3-runtime-hover-label');return label&&getComputedStyle(label).visibility==='visible'&&label.textContent.includes('× ${height}')})()`)
    await check(`hover tag stays outside the ${name} target`, `(()=>{const c=window.reactCase,label=document.querySelector('.v3-runtime-hover-label'),a=label.getBoundingClientRect(),b=c.frame.contentDocument.querySelector('#react-target').getBoundingClientRect(),f=c.frame.getBoundingClientRect(),x=f.left+c.frame.clientLeft+b.left,y=f.top+c.frame.clientTop+b.top;return a.width>0&&a.height>0&&(a.bottom<=y||a.top>=y+b.height||a.right<=x||a.left>=x+b.width)&&getComputedStyle(label).pointerEvents==='none'})()`)
  }
  await evaluate(`(()=>{const c=window.reactCase,w=c.frame.contentWindow;w.document.querySelector('#react-target').style.cssText='';w.scrollTo(0,90);w.dispatchEvent(new w.Event('blur'))})()`)
  await wait(`!document.querySelector('.v3-runtime-hover-label')`)
  await evaluate(`(()=>{const c=window.reactCase;c.frame.contentDocument.querySelector('#react-target').classList.add('moving');c.overlayX=document.querySelector('#react-host .v3-selection').style.left})()`)
  await wait(`document.querySelector('#react-host .v3-selection').style.left!==window.reactCase.overlayX`)
  await check('React overlay follows real CSS transform geometry', `document.querySelector('#react-host .v3-selection').style.left!==window.reactCase.overlayX`)
  await evaluate(`(async()=>{const c=window.reactCase;for(const active of [false,true,false,true]){c.render(active);await new Promise(resolve=>setTimeout(resolve,40))}})()`)
  await check('React mode switches clear selection and preserve runtime state', `(()=>{const c=window.reactCase,w=c.frame.contentWindow;return document.querySelector('#react-host iframe')===c.frame&&!document.querySelector('#react-host .v3-selection')&&w.token===c.token&&w.document.querySelector('#react-input').value==='state'&&w.scrollY===90})()`)
  await evaluate(`window.reactCase.frame.contentDocument.querySelector('#react-target').click()`)
  await wait(`!!document.querySelector('#react-host .v3-selection')`)
  await evaluate(`window.reactCase.frame.src=${JSON.stringify(origin + '/plain')}`)
  await wait(`!document.querySelector('#react-host .v3-selection')&&document.querySelector('#react-host .v3-runtime-actions').textContent.includes('正在连接')`)
  await check('React navigation invalidates source and old overlay', `!document.querySelector('#react-host .v3-selection')&&window.reactCase.inspections.at(-1)===undefined`)
  await evaluate(`window.reactCase.frame.src=${JSON.stringify(origin + '/react-a')}`)
  await wait(`document.querySelector('#react-host .v3-runtime-actions')?.textContent.includes('悬停检查')`)
  await evaluate(`window.reactCase.frame.contentDocument.querySelector('#react-target').click()`)
  await wait(`!!document.querySelector('#react-host .v3-selection')`)
  await check('inspection and navigation preserve Y text, metadata and file order', `(()=>{const c=window.reactCase;return JSON.stringify(c.doc.toJSON())===c.initialDocument&&['a','b'].every(id=>c.doc.getMap('files').get(id).get('content').toString()===c.sources[id])})()`)
  await evaluate(`window.reactCase.doc.getMap('files').get('a').get('content').insert(0,'<!--update-->')`)
  await wait(`!document.querySelector('#react-host .v3-selection')`)
  await check('React source generation changes invalidate the live connection', `!document.querySelector('#react-host .v3-selection')&&window.reactCase.inspections.at(-1)===undefined`)
  const dir = new URL('.codex-build/', root)
  mkdirSync(dir, { recursive: true })
  writeFileSync(new URL('runtime-step01-results.json', dir), JSON.stringify({ at: new Date().toISOString(), checks: results, sampling, scope: 'Real Chromium projection/bridge/geometry/CSP plus actual React RuntimeInspector and Y document. Full Sandpack/backend flows covered separately.' }, null, 2))
  console.log(`${results.length} browser checks passed`)
} finally {
  if (target) await call(`/close?target=${target}`).catch((error) => console.error('Close test tab:', error.message))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
