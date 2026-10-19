// Start only the public compatibility request while the main module graph loads.
// A settled result avoids unhandled rejections when the app never starts.
(() => {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6000);
  const result=fetch('/api/app-manifest',{
    method:'GET',headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal,
  }).then(async response=>({ok:response.ok,manifest:await response.json()}))
    .catch(()=>null).finally(()=>clearTimeout(timer));
  globalThis.matchradarManifestBootstrap={result};
})();
