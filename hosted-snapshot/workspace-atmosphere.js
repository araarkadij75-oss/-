/* Presentation only: isolated scenery renderer; never reads or changes CRM records. */
(() => {
  'use strict';
  const key = 'eliteservice.workspace-atmosphere.v1';
  const themes = ['rain', 'space', 'mountains', 'classic'];
  const root = document.documentElement;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
  let theme = themes.includes(saved.theme) ? saved.theme : 'rain';
  let paused = saved.paused === true;
  root.dataset.atmosphere = theme;
  root.dataset.atmospherePaused = String(paused);

  function createRenderer(stage) {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return null;
    const canvas = document.createElement('canvas');
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', {alpha:true}) : null;
    if (!ctx) return null;
    canvas.className = 'atmosphere-canvas';
    canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
    stage.appendChild(canvas);
    stage.dataset.renderer = 'canvas';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width=1, height=1, scale=1, frame=0, last=0, clock=0, scene=theme;
    let beads=[], drops=[], stars=[], ridges=[];
    let running=false, failed=false;
    // Foreground scenery is visible through the workspace, but never over readable content.
    // Cache geometry only; no order values, credentials or application state are read.
    let protectedRects=[], geometryDirty=true;
    function refreshProtection(){
      if(!document.createTreeWalker||!document.createRange)return;
      const app=document.querySelector('.app');if(!app)return;
      const rects=[], range=document.createRange();
      const walker=document.createTreeWalker(app,4);
      const keep=r=>{if(r.width&&r.height&&r.bottom>0&&r.top<height&&r.right>0&&r.left<width)rects.push([r.left-4,r.top-3,r.width+8,r.height+6]);};
      let node;
      while((node=walker.nextNode())){range.selectNodeContents(node);for(const r of range.getClientRects())keep(r);}
      for(const el of app.querySelectorAll('input,select,textarea,button,svg,canvas,img,[role="img"]'))keep(el.getBoundingClientRect());
      protectedRects=rects;geometryDirty=false;
    }
    function protectContent(){
      if(geometryDirty)refreshProtection();
      for(const r of protectedRects)ctx.clearRect(...r);
    }
    function invalidateGeometry(){geometryDirty=true;}
    document.addEventListener('scroll',invalidateGeometry,{passive:true,capture:true});
    document.addEventListener('input',invalidateGeometry,{passive:true});
    document.addEventListener('click',invalidateGeometry,{passive:true});
    if(typeof MutationObserver!=='undefined'){
      const app=document.querySelector('.app');
      if(app)new MutationObserver(invalidateGeometry).observe(app,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','open','hidden']});
    }
    const random=(a,b)=>a+Math.random()*(b-a);
    const image = new Image();
    const cloud = document.createElement('canvas');
    cloud.width=768; cloud.height=256;
    const fog=cloud.getContext('2d');
    if(fog){
      for(let i=0;i<85;i++){
        const x=random(0,768),y=random(80,180),r=random(25,100);
        const g=fog.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba(238,250,255,.18)');g.addColorStop(.6,'rgba(70,127,147,.09)');g.addColorStop(1,'rgba(238,250,255,0)');
        fog.fillStyle=g;fog.fillRect(x-r,y-r,r*2,r*2);
      }
    }
    const glow=document.createElement('canvas');glow.width=64;glow.height=64;
    const light=glow.getContext('2d');
    if(light){const g=light.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.12,'rgba(208,235,255,.8)');g.addColorStop(.35,'rgba(126,181,255,.17)');g.addColorStop(1,'rgba(126,181,255,0)');light.fillStyle=g;light.fillRect(0,0,64,64);}
    function newDrop(top=false){const r=random(3.4,7.6);return{x:random(0,width),y:top?random(-120,-20):random(-height*.1,height),r,v:random(12,90),pin:random(0,2),phase:random(0,6.28),trail:[]};}
    function resize(){
      geometryDirty=true;
      width=Math.max(1,window.innerWidth);height=Math.max(1,window.innerHeight);
      scale=Math.min(window.devicePixelRatio||1,width<800?1:1.5,Math.sqrt(2800000/(width*height)));
      canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);
      const compact=width<800;
      beads=Array.from({length:compact?48:110},()=>({x:random(0,width),y:random(0,height),r:random(.8,3.4)}));
      drops=Array.from({length:compact?15:34},()=>newDrop());
      stars=Array.from({length:compact?65:160},()=>({x:Math.random(),y:Math.random(),z:random(.2,1),phase:random(0,6.28)}));
      ridges=Array.from({length:compact?18:40},()=>({x:Math.random(),y:random(.65,.9),phase:random(0,6.28),speed:random(.5,1.4)}));
      draw(0);sync();
    }
    function dropPath(x,y,r,stretch=1){ctx.beginPath();ctx.moveTo(x,y-r*stretch);ctx.bezierCurveTo(x+r*.72,y-r*.65*stretch,x+r*1.02,y+r*.5,x+r*.52,y+r*.9);ctx.bezierCurveTo(x+r*.22,y+r*1.15,x-r*.65,y+r*1.04,x-r*.75,y+r*.4);ctx.bezierCurveTo(x-r*.99,y-r*.15,x-r*.45,y-r*.9*stretch,x,y-r*stretch);ctx.closePath();}
    function glassDrop(x,y,r,stretch=1){
      ctx.save();dropPath(x,y,r,stretch);ctx.clip();
      // Sample the same cover fit used by the CSS background, then magnify it inside the lens.
      if(image.complete&&image.naturalWidth){
        const cover=Math.max(width/image.naturalWidth,height/image.naturalHeight);
        const ox=(width-image.naturalWidth*cover)/2,oy=(height-image.naturalHeight*cover)/2;
        const sx=(x-ox)/cover,sy=(y-oy)/cover,sw=r*1.12/cover,sh=r*(stretch+1)*.63/cover;
        ctx.globalAlpha=.74;ctx.drawImage(image,sx-sw/2,sy-sh/2,sw,sh,x-r,y-r*stretch,r*2,r*(stretch+1.2));ctx.globalAlpha=1;
      }
      const tint=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
      tint.addColorStop(0,'rgba(224,246,255,.32)');tint.addColorStop(.4,'rgba(49,91,116,.08)');tint.addColorStop(.8,'rgba(16,44,65,.27)');tint.addColorStop(1,'rgba(239,253,255,.7)');
      ctx.fillStyle=tint;ctx.fillRect(x-r,y-r*stretch,r*2,r*(stretch+1.5));ctx.restore();
      dropPath(x,y,r,stretch);ctx.lineWidth=.65;ctx.strokeStyle='rgba(233,252,255,.5)';ctx.stroke();
      ctx.beginPath();ctx.ellipse(x-r*.3,y-r*.45*stretch,Math.max(.6,r*.14),Math.max(.8,r*.32),.35,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.78)';ctx.fill();
      ctx.beginPath();ctx.arc(x+r*.12,y+r*.53,r*.46,.15,2.7);ctx.strokeStyle='rgba(10,36,55,.44)';ctx.lineWidth=.85;ctx.stroke();
    }
    function rain(dt){
      for(const b of beads)glassDrop(b.x,b.y,b.r,.95);
      for(let n=0;n<drops.length;n++){
        const d=drops[n];
        if(dt){
          d.pin-=dt;
          if(d.pin<=0){d.v=Math.min(180,d.v+dt*(13+d.r*4));d.y+=d.v*dt;d.x+=Math.sin(d.y*.018+d.phase)*dt*4;
            if(Math.random()<dt*.12){d.pin=random(.15,.7);d.v*=.35;}
            d.trail.push([d.x,d.y]);if(d.trail.length>30)d.trail.shift();
          }
          for(const b of beads){if(Math.abs(b.x-d.x)<d.r*.8&&Math.abs(b.y-d.y)<d.r){d.r=Math.min(9.5,Math.sqrt(d.r*d.r+b.r*b.r*.35));d.v+=7;b.x=random(0,width);b.y=random(0,height);}}
          if(d.y>height+30){drops[n]=newDrop(true);continue;}
        }
        if(d.trail.length>1){const start=d.trail[0];const g=ctx.createLinearGradient(start[0],start[1],d.x,d.y);g.addColorStop(0,'rgba(226,248,255,0)');g.addColorStop(.75,'rgba(226,248,255,.13)');g.addColorStop(1,'rgba(226,248,255,.34)');ctx.beginPath();ctx.moveTo(start[0],start[1]);for(const p of d.trail)ctx.lineTo(p[0],p[1]);ctx.lineCap='round';ctx.strokeStyle=g;ctx.lineWidth=d.r*.7;ctx.stroke();ctx.strokeStyle='rgba(237,252,255,.16)';ctx.lineWidth=.7;ctx.stroke();}
        glassDrop(d.x,d.y,d.r,1.1+Math.min(.8,d.v/160));
      }
    }
    function space(){
      // Several independent depths, not a flat blinking wallpaper.
      ctx.save();ctx.shadowColor='rgba(57,83,156,.65)';ctx.shadowBlur=3;
      for(const s of stars){const x=(s.x*width+clock*s.z*1.8)%width,y=s.y*height+Math.sin(clock*.07+s.phase)*3*s.z;const a=.2+.48*(.5+.5*Math.sin(clock*.65+s.phase));const size=3+s.z*8;ctx.globalAlpha=a;ctx.drawImage(glow,x-size/2,y-size/2,size,size);if(s.z>.94){ctx.fillStyle='#dfedff';ctx.fillRect(x-.4,y-3,.8,6);ctx.fillRect(x-3,y-.4,6,.8);}}
      ctx.restore();ctx.globalAlpha=1;
      const cycle=clock%18;
      if(cycle>11&&cycle<12.4){const p=(cycle-11)/1.4,x=width*(.18+p*.65),y=height*(.12+p*.32),tail=160;ctx.save();ctx.globalAlpha=Math.sin(p*Math.PI)*.85;const g=ctx.createLinearGradient(x-tail,y-tail*.38,x,y);g.addColorStop(0,'rgba(140,202,255,0)');g.addColorStop(.8,'rgba(162,221,255,.45)');g.addColorStop(1,'rgba(255,255,255,1)');ctx.strokeStyle=g;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-tail,y-tail*.38);ctx.lineTo(x,y);ctx.stroke();ctx.drawImage(glow,x-9,y-9,18,18);ctx.restore();}
      const gx=width*(.2+Math.sin(clock*.022)*.07),gy=height*.22;
      const g=ctx.createRadialGradient(gx,gy,0,gx,gy,width*.48);g.addColorStop(0,'rgba(94,143,255,.065)');g.addColorStop(1,'rgba(94,143,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
    }
    function mountains(){
      // Soft cloud textures at different distances move independently across the valley.
      const layers=[{y:.2,w:1.7,h:.28,s:4,a:.32},{y:.42,w:1.4,h:.25,s:7,a:.42},{y:.71,w:1.9,h:.28,s:11,a:.28}];
      for(const layer of layers){const span=width*layer.w,x=((clock*layer.s)%span)-span*.4;ctx.globalAlpha=layer.a;ctx.drawImage(cloud,x,height*layer.y,span,height*layer.h);ctx.drawImage(cloud,x-span,height*layer.y,span,height*layer.h);}ctx.globalAlpha=1;
      // Reflections stay in the lake band and breathe rather than flash.
      for(const p of ridges){const a=(.5+.5*Math.sin(clock*p.speed+p.phase))*.17;ctx.fillStyle=`rgba(234,255,255,${a})`;const x=width*(.22+p.x*.48),y=height*(.53+(p.y-.65)*.32);ctx.fillRect(x+Math.sin(clock*.3+p.phase)*6,y,3+p.x*11,.65);}
      const x=width*(.72+Math.sin(clock*.018)*.04);const sun=ctx.createRadialGradient(x,height*.07,0,x,height*.07,width*.65);sun.addColorStop(0,'rgba(232,251,255,.08)');sun.addColorStop(.55,'rgba(224,249,255,.025)');sun.addColorStop(1,'rgba(224,249,255,0)');ctx.fillStyle=sun;ctx.fillRect(0,0,width,height);
    }
    function draw(dt){
      ctx.clearRect(0,0,width,height);
      if(scene==='classic')return;
      clock+=dt;
      if(scene==='rain')rain(dt);else if(scene==='space')space();else mountains();
      protectContent();
    }
    function active(){return !failed&&!paused&&!document.hidden&&!reduced.matches&&scene!=='classic';}
    function tick(now){
      frame=0;if(!active()){running=false;last=0;return;}
      if(!last)last=now;
      const elapsed=now-last;
      if(elapsed>=1000/30){const dt=Math.min(.05,elapsed/1000);last=now;
        try{draw(dt);}catch(_){failed=true;stage.dataset.renderer='static';ctx.clearRect(0,0,width,height);running=false;return;}
      }
      frame=window.requestAnimationFrame(tick);
    }
    function sync(){
      root.dataset.atmosphereReduced=String(reduced.matches);
      root.dataset.atmosphereHidden=String(document.hidden);
      if(active()){if(!running){running=true;last=0;frame=window.requestAnimationFrame(tick);}}
      else{if(frame)window.cancelAnimationFrame(frame);frame=0;running=false;last=0;}
    }
    function setTheme(next){if(scene!==next){scene=next;clock=0;draw(0);}sync();}
    image.onload=()=>{if(scene==='rain')draw(0);};
    image.src=new URL('./rain-courtyard.png',document.baseURI).href;
    window.addEventListener('resize',resize,{passive:true});
    if(reduced.addEventListener)reduced.addEventListener('change',sync);
    window.addEventListener('pagehide',()=>{if(frame)window.cancelAnimationFrame(frame);frame=0;running=false;last=0;});
    window.addEventListener('pageshow',sync);
    resize();
    return {setTheme,sync};
  }

  function init() {
    const select=document.getElementById('workspaceAtmosphere'),pause=document.getElementById('rainMotionPaused'),stage=document.getElementById('workspaceAtmosphereStage');
    if(!select||!pause||!stage)return;
    select.value=theme;pause.checked=paused;
    let renderer=null;
    function apply(){theme=themes.includes(select.value)?select.value:'rain';paused=pause.checked;root.dataset.atmosphere=theme;root.dataset.atmospherePaused=String(paused);try{localStorage.setItem(key,JSON.stringify({theme,paused}));}catch(_){}if(renderer)renderer.setTheme(theme);}
    select.addEventListener('change',apply);pause.addEventListener('change',apply);
    document.addEventListener('visibilitychange',()=>{root.dataset.atmosphereHidden=String(document.hidden);if(renderer)renderer.sync();});
    try{renderer=createRenderer(stage);}catch(_){stage.dataset.renderer='static';}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
