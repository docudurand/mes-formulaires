(function () {
  // Calcule la hauteur des barres pour ajuster le layout
  function dsgUpdateChromeHeight() {
    const topbar = document.querySelector(".topbar");
    const subbar = document.querySelector(".subbar");

    const h = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    document.documentElement.style.setProperty("--chrome-h", h + "px");
  }

  window.addEventListener("load", dsgUpdateChromeHeight, { once: true });
  window.addEventListener("resize", dsgUpdateChromeHeight);

  // Menus deroulants
  const menus = Array.from(document.querySelectorAll(".menu"));

  // Ferme tous les menus sauf un
  function closeAll(except = null) {
    menus.forEach((m) => {
      if (m !== except) m.classList.remove("open");
    });
  }

  // Si pas mobile, on passe en mode clic
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

  // ESC pour fermer les menus
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

})();
