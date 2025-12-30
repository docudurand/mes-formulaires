(function () {
  // DSG_CHROME_HEIGHT
  // Calcule la hauteur réelle du "chrome" (topbar + subbar) pour que le cadre
  // prenne EXACTEMENT la hauteur visible restante.
  function dsgUpdateChromeHeight() {
    const topbar = document.querySelector(".topbar");
    const subbar = document.querySelector(".subbar");

    // offsetHeight inclut le padding + border -> c'est ce qu'on veut ici.
    const h = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    document.documentElement.style.setProperty("--chrome-h", h + "px");
  }

  window.addEventListener("load", dsgUpdateChromeHeight, { once: true });
  window.addEventListener("resize", dsgUpdateChromeHeight);

  // Menus (mobile)
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

  // IMPORTANT : on ne force PAS de hauteur fixe sur les iframes.
  // Le cadre (iframe) est en height:100% via le CSS et le scroll se fait dedans.
})();
