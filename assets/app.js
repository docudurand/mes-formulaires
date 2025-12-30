(function () {

  
  // DSG_CHROME_HEIGHT : calcule la hauteur des barres (topbar + subbar) pour que les iframes remplissent l'écran
  function dsgUpdateChromeHeight(){
    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');
    const h = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    // + marges/paddings main (.wrap padding-top + bottom)
    const wrap = document.querySelector('main.wrap');
    const cs = wrap ? getComputedStyle(wrap) : null;
    const pad = cs ? (parseFloat(cs.paddingTop)||0) + (parseFloat(cs.paddingBottom)||0) : 0;
    document.documentElement.style.setProperty('--chrome-h', (h + pad) + 'px');
  }
  window.addEventListener('load', dsgUpdateChromeHeight, { once:true });
  window.addEventListener('resize', dsgUpdateChromeHeight);

const menus = Array.from(document.querySelectorAll(".menu"));

  function closeAll(except = null) {
    menus.forEach((m) => {
      if (m !== except) m.classList.remove("open");
    });
  }

  const enableClickMenus = window.matchMedia("(hover: none)").matches;

  if (enableClickMenus && menus.length) {
    menus.forEach((menu) => {
      const btn = menu.querySelector(".menu-btn");
      if (!btn) return;

      btn.addEventListener("click", (e) => {
        if (btn.tagName === "A") e.preventDefault();

        const isOpen = menu.classList.contains("open");
        closeAll();
        menu.classList.toggle("open", !isOpen);
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".menu")) closeAll();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

  const embeds = Array.from(document.querySelectorAll("iframe.embed-frame"));

  if (embeds.length) {
    const resizeEmbeds = () => {
      const vh = window.innerHeight || 900;
      const h = Math.max(900, Math.round(vh * 1.65));
      embeds.forEach((fr) => {
        fr.style.height = h + "px";
      });
    };

    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(resizeEmbeds, 150);
    });

    window.addEventListener("load", resizeEmbeds);
    resizeEmbeds();
  }
})();