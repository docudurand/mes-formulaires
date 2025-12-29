(function(){
  const menus = Array.from(document.querySelectorAll('.menu'));
  function closeAll(except=null){
    menus.forEach(m => { if(m !== except) m.classList.remove('open'); });
  }

  const enableClickMenus = window.matchMedia('(hover: none)').matches;

  if (enableClickMenus) {
    menus.forEach(menu => {
      const btn = menu.querySelector('.menu-btn');
      if(!btn) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = menu.classList.contains('open');
        closeAll();
        menu.classList.toggle('open', !isOpen);
      });
    });

    document.addEventListener('click', (e) => {
      if(!e.target.closest('.menu')) closeAll();
    });
  }

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') closeAll();
  });
})();

/*
  Responsive des pages "embed" (iframe) :
  Objectif : pas de scroll dans le cadre, uniquement sur la page.
  Comme certaines iframes sont cross-domain (odoo/onrender), on ne peut pas
  mesurer leur hauteur. On applique donc :
  - une hauteur généreuse par défaut
  - une adaptation minimale à la hauteur d'écran
  - la possibilité d'override via classes CSS (.embed-frame--tall/.embed-frame--xl)
*/
(function(){
  const frames = Array.from(document.querySelectorAll('iframe.embed-frame'));
  if (!frames.length) return;

  document.body.classList.add('page-embed');

  function computeFrameHeight(){
    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');
    const headerH = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    const base = Math.max(0, window.innerHeight - headerH - 28);

    frames.forEach((frame) => {
      // si la page a explicitement demandé "tall" / "xl", on ne touche pas
      if (frame.classList.contains('embed-frame--tall') || frame.classList.contains('embed-frame--xl')) return;

      const h = Math.max(1400, base); // 1400px évite la plupart des scrolls internes
      frame.style.height = `${h}px`;
      frame.setAttribute('scrolling', 'no');
      frame.style.overflow = 'hidden';
    });
  }

  // 1er calcul + recalcul au resize
  window.addEventListener('load', computeFrameHeight);
  window.addEventListener('resize', computeFrameHeight);
})();