(function(){
  const btnBurger = document.getElementById('btnBurger');
  const btnClose  = document.getElementById('btnClose');
  const drawer    = document.getElementById('drawer');
  const backdrop  = document.getElementById('backdrop');
  const frame     = document.getElementById('contentFrame');
  const welcome   = document.getElementById('welcome');

  function openDrawer(){
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    btnBurger.setAttribute('aria-expanded','true');
    backdrop.hidden = false;
  }

  function closeDrawer(){
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    btnBurger.setAttribute('aria-expanded','false');
    backdrop.hidden = true;
  }

  btnBurger.addEventListener('click', openDrawer);
  btnClose.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  function openInFrame(url){
    try{
      frame.src = url;
      frame.style.display = 'block';
      if (welcome) welcome.style.display = 'none';
      closeDrawer();
    }catch(e){}
  }

  let linksCache = null;

async function getCommerceLinks(){
  if (linksCache) return linksCache;

  const r = await fetch("/api/commerce-links", { credentials: "include" });
  if (!r.ok) throw new Error("Impossible de charger les liens commerce");

  linksCache = await r.json();
  return linksCache;
}

document.querySelectorAll('[data-key]').forEach((btn)=>{
  btn.addEventListener('click', async () => {
    const key = btn.getAttribute('data-key');
    const links = await getCommerceLinks();
    const url = links && key ? links[key] : null;
    if (url) openInFrame(url);
  });
});

  let startX = null;
  drawer.addEventListener('touchstart', (e)=>{
    startX = e.touches && e.touches[0] ? e.touches[0].clientX : null;
  }, {passive:true});

  drawer.addEventListener('touchend', (e)=>{
    if(startX == null) return;
    const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : startX;
    if(endX - startX < -60) closeDrawer();
    startX = null;
  }, {passive:true});
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
