/* Cantiere360 – service worker v3: notifiche con suono, apertura dell'app e uso senza rete */
const SHELL="c360-shell-v4",LIBS="c360-libs-v1";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(SHELL).then(c=>c.addAll(["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png"]).catch(()=>{})))});
self.addEventListener("activate",e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith("c360-shell-")&&k!==SHELL)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
  if(u.origin===self.location.origin){
    if(u.pathname.endsWith("/version.json"))return;            // sempre dalla rete: serve per gli aggiornamenti
    if(u.pathname.includes("/dwg/"))return;                      // libreria DWG: la gestisce il browser
    // prima la rete (versione più recente), poi la copia salvata se manca il campo
    e.respondWith((async()=>{try{const net=fetch(r);const res=await (r.mode==="navigate"?Promise.race([net,new Promise((_,ko)=>setTimeout(()=>caches.open(SHELL).then(c=>c.match("./index.html")).then(m=>m?ko(new Error("lento")):0),4000))]):net);if(res&&res.ok&&res.type==="basic"){const c=await caches.open(SHELL);c.put(r.mode==="navigate"?"./index.html":r,res.clone()).catch(()=>{})}return res}
      catch(_){const c=await caches.open(SHELL);return (r.mode==="navigate"?await c.match("./index.html"):undefined)||(await c.match(r,{ignoreSearch:true}))||Response.error()}})());
    return;
  }
  if(u.hostname==="cdnjs.cloudflare.com"||u.hostname==="cdn.jsdelivr.net"||u.hostname==="unpkg.com"||u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com"){
    // librerie esterne (PDF, caratteri): copia salvata subito, aggiornata in background
    e.respondWith((async()=>{const c=await caches.open(LIBS);const hit=await c.match(r);const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==="opaque"))c.put(r,res.clone()).catch(()=>{});return res}).catch(()=>null);return hit||(await net)||Response.error()})());
  }
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||"./",self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const c of list){if("focus" in c){c.navigate&&c.navigate(url).catch(()=>{});return c.focus()}}
    return self.clients.openWindow(url);
  }));
});
self.addEventListener("push",e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||"Cantiere360",{body:d.body||"",tag:d.tag||"c360",icon:"icon-192.png",badge:"icon-192.png",renotify:true,silent:false,vibrate:[200,100,200],data:{url:d.url||"./#m-avvisi"}}));
});
