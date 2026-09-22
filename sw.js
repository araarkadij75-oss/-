const CACHE='master-ai-18.17.19-shell-v5';
const SHELL=[
  './',
  './index.html',
  './dispatcher-logistic.html',
  './master.html',
  './manifest.json',
  './manifest-dispatcher-logistic.json',
  './manifest-master.json',
  './icon.svg',
  './cloud-config.js',
  './quota-safe-v181719.js',
  './premium-v181721.css'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('master-ai-')&&k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        return res;
      }).catch(async()=>{
        const cached=await caches.match(req);
        if(cached)return cached;
        if(url.pathname.endsWith('/master.html'))return caches.match('./master.html');
        if(url.pathname.endsWith('/dispatcher-logistic.html'))return caches.match('./dispatcher-logistic.html');
        return caches.match('./index.html');
      })
    );
    return;
  }

  const critical=/\/(?:cloud-config\.js|quota-safe-v181719\.js)$/.test(url.pathname);
  if(critical){
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        return res;
      }).catch(()=>caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const network=fetch(req).then(res=>{
        if(res.ok){
          const copy=res.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        }
        return res;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});
