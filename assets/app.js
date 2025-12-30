(function () {

  
  // DSG_FIXED_LAYOUT_V6_1 : recalcul très tôt + plusieurs passes (polices, layout, etc.)
  function dsgUpdateFixedHeights(){
    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');

    const topH = topbar ? topbar.getBoundingClientRect().height : 0;
    const subH = subbar ? subbar.getBoundingClientRect().height : 0;

    document.documentElement.style.setProperty('--topbar-h', topH + 'px');
    document.documentElement.style.setProperty('--subbar-h', subH + 'px');
    document.documentElement.style.setProperty('--main-top', (topH + subH) + 'px');
  }

  // 1) dès que le DOM est prêt
  document.addEventListener('DOMContentLoaded', dsgUpdateFixedHeights, { once:true });

  // 2) au chargement complet + resize
  window.addEventListener('load', dsgUpdateFixedHeights, { once:true });
  window.addEventListener('resize', dsgUpdateFixedHeights);

  // 3) quelques recalculs rapides au début (fonts/images)
  (function(){
    let n = 0;
    const tick = () => {
      dsgUpdateFixedHeights();
      if (++n < 12) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(dsgUpdateFixedHeights, 250);
    setTimeout(dsgUpdateFixedHeights, 800);
  })();

// DSG_CHROME_HEIGHT (V2) : calcule la hauteur réelle du haut (topbar + subbar)
  function dsgUpdateChromeHeight(){
    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');
    const h = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    document.documentElement.style.setProperty('--chrome-h', h + 'px');
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