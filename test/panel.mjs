import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {outputFiles}=await build({stdin:{contents:"import {XRControls} from './src/xr-ui.js'; window.XRControls=XRControls;",resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const b=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
try {
const p=await b.newPage({viewport:{width:1100,height:2000}}); await p.setContent('<body style="margin:0;padding:24px;background:#3a3f47;color:#fff;font:20px system-ui"></body>');
await p.addScriptTag({content:outputFiles[0].text});
const report=await p.evaluate(()=>{
 const base={title:'VR180 — Mountain hike in Yosemite National Park with a long title',status:'Playing 1080p',quality:1080,requestedQuality:1080,qualities:[720,1080,1440,2160,4320],time:78,duration:162,paused:false,busy:false,error:''};
 let state=base; const canvas=document.createElement('canvas'); canvas.width=1024;canvas.height=312;
 const gl=canvas.getContext('webgl'); const controls=new XRControls(gl,()=>state,()=>{}); const reports=[];
 const originalText=controls.ctx.fillText.bind(controls.ctx);let texts=[];controls.ctx.fillText=(...args)=>{texts.push(String(args[0]));return originalText(...args)};
 const cases=[['Playing',{},false,'toggle'],['Paused with timeline hover',{paused:true},false,'seek'],['Quality menu',{},true,'quality:1440'],['Loading menu',{quality:0,requestedQuality:2160,busy:true,status:'Loading 2160p…'},true],['Loading',{quality:0,requestedQuality:2160,busy:true,status:'Loading 2160p…'},false],['Error',{quality:0,requestedQuality:2160,error:'The media request failed (503). Retry this VR source.'},false],['Many qualities',{qualities:[720,800,900,1000,1080,1200,1440,1600,1800,2160,2880,4320]},true]];
 for(const [name,changes,menu,hover] of cases) {
  state={...base,...changes};controls.menu=menu;controls.menuPage=0;controls.signature=null;controls.pointers.clear();
  if(hover)controls.pointers.set('test',{hit:{id:hover,ratio:.65}});
  texts=[];controls.paint(1000);
  const h=document.createElement('h3');h.textContent=name;document.body.append(h);
  const c=document.createElement('canvas');c.width=1024;c.height=controls.panelHeight;c.getContext('2d').drawImage(controls.canvas,0,0);document.body.append(c);
  reports.push({name,height:controls.panelHeight,texts:[...texts],buttons:controls.buttons.map(({id,x,y,w,h})=>({id,x,y,w,h}))});
 }
 controls.pointers.clear();controls.pointers.set('test',{hit:{id:'quality-next'}});
 for(const type of ['selectstart','selectend','select'])controls.input(type,'test');
 controls.paint(2000);const nextPage=controls.buttons.filter(b=>b.id.startsWith('quality:')).map(b=>b.id);
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 state=base;controls.menu=false;controls.signature=null;controls.pointers.clear();controls.paint(3000);controls.anchor=identity;
 const projection=identity.slice();projection[0]=1/.64;projection[5]=1/.195;
 gl.clearColor(.1,.4,.2,1);gl.clear(gl.COLOR_BUFFER_BIT);
 controls.draw({projectionMatrix:projection,transform:{inverse:{matrix:identity}}},{x:0,y:0,width:1024,height:312});
 const corner=new Uint8Array(4),center=new Uint8Array(4);gl.readPixels(2,2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,corner);gl.readPixels(512,200,1,1,gl.RGBA,gl.UNSIGNED_BYTE,center);
 const filter=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER),error=gl.getError();controls.dispose();
 return {states:reports,nextPage,corner:[...corner],center:[...center],filter,error};
});
for(const r of report.states){assert.equal(r.height,312);for(const button of r.buttons){assert.ok(button.y+button.h<=r.height&&button.x+button.w<=1024,`${r.name}: ${button.id} fits`);assert.ok(button.h>=72,`${r.name}: ${button.id} has a full-height target`);}
assert.ok(!r.texts.some(t=>t.includes('Trigger away')||t.includes('When hidden')));
if(r.name.startsWith('Loading'))assert.equal(r.texts.filter(t=>t.includes('Loading')).length,1,'one loading label');}
assert.deepEqual(report.nextPage,['quality:1080','quality:1200','quality:1440','quality:1600']);
assert.ok(report.corner[1]>95&&report.corner[1]<110,'rounded corner preserves video background');assert.ok(report.center[0]<30&&report.center[1]<30,'card surface is opaque');
assert.equal(report.filter,9987);assert.equal(report.error,0);
await mkdir('test-output',{recursive:true});await p.screenshot({path:'test-output/xr-panel-review.png',fullPage:true});console.log({states:report.states.map(({name,height})=>({name,height})),corner:report.corner,filter:report.filter});
}finally{await b.close()}
