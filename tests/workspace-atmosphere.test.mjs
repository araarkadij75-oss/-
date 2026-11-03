import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../hosted-snapshot/workspace-atmosphere.js',import.meta.url),'utf8');

// Minimal browser adapter: assert observable settings and scheduling, not drawing internals.
function run(saved='{}', options={}) {
  const events={}, windowEvents={}, controls={}, writes=[], frames=new Map(), canvases=[];
  const root={dataset:{}};
  let sequence=0, paintCount=0, cancelled=0, mediaListener;
  const clears=[];let dropsPainted=0;
  const media={matches:!!options.reduced,addEventListener(name,fn){if(name==='change')mediaListener=fn;}};
  for(const id of ['workspaceAtmosphere','rainMotionPaused','workspaceAtmosphereStage']) {
    controls[id]={value:'',checked:false,dataset:{},children:[],appendChild(x){this.children.push(x);},addEventListener(t,cb){this[t]=cb;}};
  }
  function makeCanvas() {
    const context={};
    for(const name of ['clearRect','setTransform','fillRect','drawImage','save','restore','beginPath','moveTo','bezierCurveTo','closePath','clip','ellipse','fill','arc','stroke','lineTo']) {
      context[name]=(...args)=>{if(name==='clearRect'){paintCount++;clears.push(args);}if(name==='ellipse')dropsPainted++;};
    }
    context.createRadialGradient=context.createLinearGradient=()=>({addColorStop(){}});
    const canvas={style:{},width:0,height:0,setAttribute(){},getContext(){if(options.canvasThrows)throw Error('unavailable');return options.noCanvas?null:context;}};
    canvases.push(canvas);return canvas;
  }
  const document={documentElement:root,readyState:'complete',hidden:!!options.hidden,baseURI:'https://crm.example/candidate/index.html',getElementById:id=>controls[id],createElement:()=>makeCanvas(),addEventListener:(name,fn)=>events[name]=fn};
  if(options.protection){
    document.querySelector=()=>({querySelectorAll:()=>[{getBoundingClientRect:()=>({left:300,top:200,width:100,height:40,right:400,bottom:240})}]});
    document.createTreeWalker=()=>{let done=false;return{nextNode(){if(done)return null;done=true;return {};}};};
    document.createRange=()=>({selectNodeContents(){},getClientRects:()=>[{left:-1000,top:-1000,width:5000,height:5000,right:4000,bottom:4000}]});
  }
  const localStorage={getItem(){if(options.storageBlocked)throw Error('denied');return saved;},setItem(key,value){if(options.storageBlocked)throw Error('denied');writes.push(JSON.parse(value));}};
  const window={innerWidth:1440,innerHeight:900,devicePixelRatio:2,matchMedia:()=>media,addEventListener:(name,fn)=>windowEvents[name]=fn,requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame(id){cancelled++;frames.delete(id);}};
  class Image { complete=false; naturalWidth=0; naturalHeight=0; }
  vm.runInNewContext(code,{document,localStorage,window,Image,URL});
  return {root,controls,writes,document,events,frames,canvases,windowEvents,clears,
    get dropsPainted(){return dropsPainted;},get paintCount(){return paintCount;},get cancelled(){return cancelled;},
    tick(now){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(now);},
    reduce(value){media.matches=value;mediaListener?.();},
    choose(value){controls.workspaceAtmosphere.value=value;controls.workspaceAtmosphere.change();},
    pause(value){controls.rainMotionPaused.checked=value;controls.rainMotionPaused.change();},
    hide(value){document.hidden=value;events.visibilitychange();}
  };
}

test('appearance restores and persists theme and pause independently of CRM data',()=>{
  const r=run('{"theme":"space","paused":true}');
  assert.equal(r.root.dataset.atmosphere,'space');assert.equal(r.controls.rainMotionPaused.checked,true);assert.equal(r.frames.size,0);
  r.choose('mountains');assert.deepEqual(r.writes[0],{theme:'mountains',paused:true});
  r.pause(false);assert.equal(r.root.dataset.atmospherePaused,'false');assert.equal(r.frames.size,1);
  const restored=run(JSON.stringify(r.writes.at(-1)));
  assert.equal(restored.controls.workspaceAtmosphere.value,'mountains');assert.equal(restored.controls.rainMotionPaused.checked,false);
});

test('malformed preferences and blocked storage do not break theme controls',()=>{
  for(const raw of ['{broken','null','{"theme":"invalid"}'])assert.equal(run(raw).root.dataset.atmosphere,'rain');
  const r=run(null,{storageBlocked:true});assert.doesNotThrow(()=>r.choose('space'));assert.equal(r.root.dataset.atmosphere,'space');
});

test('classic has no animation loop, including after a saved restart',()=>{
  const r=run('{"theme":"classic"}');assert.equal(r.frames.size,0);assert.equal(r.root.dataset.atmosphere,'classic');
  r.choose('rain');assert.equal(r.frames.size,1);r.tick(100);r.tick(150);assert.ok(r.paintCount>1);
  r.choose('classic');assert.equal(r.frames.size,0);assert.ok(r.cancelled>0);
  const restored=run(JSON.stringify(r.writes.at(-1)));assert.equal(restored.frames.size,0);assert.equal(restored.controls.workspaceAtmosphere.value,'classic');
});

test('pause and visibility changes cancel rendering without spawning duplicate loops',()=>{
  const r=run();assert.equal(r.frames.size,1);r.tick(100);r.tick(150);
  r.pause(true);const paints=r.paintCount;assert.equal(r.frames.size,0);r.tick(200);assert.equal(r.paintCount,paints);
  r.hide(true);r.pause(false);assert.equal(r.frames.size,0);
  r.hide(false);assert.equal(r.frames.size,1);r.hide(false);assert.equal(r.frames.size,1);
  r.windowEvents.pagehide();assert.equal(r.frames.size,0);r.windowEvents.pageshow();assert.equal(r.frames.size,1);
});

test('reduced motion stops every theme while preserving the scenery selection',()=>{
  const r=run('{"theme":"mountains"}',{reduced:true});assert.equal(r.frames.size,0);assert.equal(r.root.dataset.atmosphereReduced,'true');
  r.choose('space');assert.equal(r.frames.size,0);assert.equal(r.root.dataset.atmosphere,'space');
  r.reduce(false);assert.equal(r.frames.size,1);r.reduce(true);assert.equal(r.frames.size,0);assert.equal(r.root.dataset.atmosphere,'space');
});

test('canvas rejection leaves a working static appearance selector',()=>{
  for(const options of [{noCanvas:true},{canvasThrows:true}]){
    const r=run('{}',options);assert.equal(r.frames.size,0);assert.doesNotThrow(()=>r.choose('mountains'));assert.equal(r.root.dataset.atmosphere,'mountains');assert.doesNotThrow(()=>r.pause(true));
  }
});

test('an initially hidden page does not schedule decorative work',()=>{
  const r=run('{}',{hidden:true});assert.equal(r.frames.size,0);r.hide(false);assert.equal(r.frames.size,1);
});

test('particles avoid content without rectangular holes in continuous scenery',()=>{
  const normal=run();assert.ok(normal.dropsPainted>0);
  const r=run('{}',{protection:true});assert.equal(r.dropsPainted,0);
  r.tick(100);r.tick(150);assert.equal(r.dropsPainted,0);
  r.choose('mountains');r.events.scroll();r.tick(200);
  assert.ok(r.clears.every(x=>x[0]===0&&x[1]===0&&x[2]===1440&&x[3]===900));
  assert.equal(r.frames.size,1);
});
