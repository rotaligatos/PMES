/* ModCraft PMES — service worker.
 *
 * ⚠ THIS WORKER MUST NEVER CACHE ANYTHING (same rule as Modcraft's sw.js). A caching worker would
 * keep serving an old copy after a fix ships, with no obvious way out for the user.
 *
 * It exists only so the app can be installed: Chrome will not offer to install without a fetch
 * handler. It always goes to the network, stores nothing, and shows a plain notice when a page
 * navigation fails because there is no connection.
 */
'use strict';
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

var OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Offline</title>'+
  '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b1220;'+
  'color:#e5e9f0;font:15px/1.5 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif">'+
  '<div style="text-align:center;padding:24px">'+
  '<div style="font-size:18px;font-weight:600;margin-bottom:6px">No connection</div>'+
  '<div style="color:#9aa5b5">ModCraft PMES works live against the database, so there is nothing to show '+
  'offline. Reconnect and reload.</div></div>';

self.addEventListener('fetch', function(event){
  if (event.request.mode !== 'navigate') return;   // assets pass straight through, untouched
  event.respondWith(fetch(event.request).catch(function(){
    return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
