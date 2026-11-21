/* Cantiere360 – service worker: notifiche e apertura dell'app */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||"/";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const c of list){if("focus" in c){c.navigate&&c.navigate(url).catch(()=>{});return c.focus()}}
    return self.clients.openWindow(url);
  }));
});
self.addEventListener("push",e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
  const quiet=d.tag==="c360-versione";
  e.waitUntil(self.registration.showNotification(d.title||"Cantiere360",Object.assign({body:d.body||"",tag:d.tag||"c360",icon:"/icon-192.png",badge:"/icon-192.png",data:{url:d.url||"/#m-avvisi"}},quiet?{silent:true}:{renotify:true,vibrate:[200,100,200]})));
});
