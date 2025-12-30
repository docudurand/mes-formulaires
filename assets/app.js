(function () {

  // DSG_CHROME_HEIGHT_V4 : calcule hauteur visible (visualViewport) + hauteur header (topbar+subbar)
  function dsgUpdateViewportVars(){
    const vv = window.visualViewport;
    const visibleH = vv && vv.height ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', visibleH + 'px');

    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');

    const h = (topbar ? topbar.getBoundingClientRect().height : 0) + (subbar ? subbar.getBoundingClientRect().height : 0);
    document.documentElement.style.setProperty('--chrome-h', h + 'px');
  }

  window.addEventListener('load', dsgUpdateViewportVars, { once:true });
  window.addEventListener('resize', dsgUpdateViewportVars);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', dsgUpdateViewportVars);
    // sur certains navigateurs, la hauteur visible bouge pendant scroll (barre d'URL)
    window.visualViewport.addEventListener('scroll', dsgUpdateViewportVars);
  }

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