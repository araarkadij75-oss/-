import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../hosted-snapshot/workspace-atmosphere.js',import.meta.url),'utf8');
function run(saved,broken=false){
 const events={},controls={},writes=[]; const root={dataset:{}};
 for(const id of ['workspaceAtmosphere','rainMotionPaused','workspaceAtmosphereStage'])controls[id]={value:'',checked:false,children:[],appendChild(x){this.children.push(x)},addEventListener(t,cb){this[t]=cb}};
 const document={documentElement:root,readyState:'complete',hidden:false,getElementById:id=>controls[id],createDocumentFragment:()=>({children:[],appendChild(x){this.children.push(x)}}),createElement:()=>({style:{setProperty(){}}}),addEventListener:(n,fn)=>events[n]=fn};
 const localStorage={getItem(){if(broken)throw Error('denied');return saved},setItem(k,v){if(broken)throw Error('denied');writes.push(JSON.parse(v))}};
 vm.runInNewContext(code,{document,localStorage});return {root,controls,writes,document,events};
}
test('appearance restores selected theme and pause independently of CRM data',()=>{const r=run('{"theme":"space","paused":true}');assert.equal(r.root.dataset.atmosphere,'space');assert.equal(r.controls.rainMotionPaused.checked,true);r.controls.workspaceAtmosphere.value='mountains';r.controls.workspaceAtmosphere.change();assert.deepEqual(r.writes[0],{theme:'mountains',paused:true});r.controls.rainMotionPaused.checked=false;r.controls.rainMotionPaused.change();assert.equal(r.root.dataset.atmospherePaused,'false');});
test('malformed preferences and blocked local storage cannot break CRM startup',()=>{for(const raw of ['{broken','null','{"theme":"invalid"}'])assert.equal(run(raw).root.dataset.atmosphere,'rain');const r=run(null,true);r.controls.workspaceAtmosphere.value='space';assert.doesNotThrow(()=>r.controls.workspaceAtmosphere.change());assert.equal(r.root.dataset.atmosphere,'space');});
test('background pauses when the application is hidden',()=>{const r=run('{}');r.document.hidden=true;r.events.visibilitychange();assert.equal(r.root.dataset.atmosphereHidden,'true');r.document.hidden=false;r.events.visibilitychange();assert.equal(r.root.dataset.atmosphereHidden,'false');});
