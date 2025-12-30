(function () {
  function dsgUpdateChromeHeight() {
    const topbar = document.querySelector(".topbar");
    const subbar = document.querySelector(".subbar");

    const h = (topbar ? topbar.offsetHeight : 0) + (subbar ? subbar.offsetHeight : 0);
    document.documentElement.style.setProperty("--chrome-h", h + "px");
  }

  window.addEventListener("load", dsgUpdateChromeHeight, { once: true });
  window.addEventListener("resize", dsgUpdateChromeHeight);

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

})();
