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

  function loadInFrame(src){
    frame.src = src;
    welcome.style.display = 'none';
    frame.style.display = 'block';
  }

  document.querySelectorAll('.navBtn[data-src]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const src = btn.getAttribute('data-src');
      if(src) loadInFrame(src);
      closeDrawer();
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
