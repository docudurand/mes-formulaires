(function(){
  // -------------------------------
  // Menus (mobile/tablette)
  // -------------------------------
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

  // -------------------------------
  // Pages avec iframe embarqué
  // -> un seul scroll (sur la page)
  // -------------------------------
  const frame = document.querySelector('iframe.embed-frame');
  if(frame){
    document.body.classList.add('page-embed');

    const setH = () => {
      // On ne peut pas mesurer le contenu si l'iframe est cross-domain.
      // Donc: hauteur "confort" + responsive.
      const vh = Math.max(600, window.innerHeight || 900);
      const h = Math.max(1400, Math.floor(vh * 1.55));
      frame.style.height = h + 'px';
    };

    setH();
    window.addEventListener('resize', setH, { passive:true });
  }
})();