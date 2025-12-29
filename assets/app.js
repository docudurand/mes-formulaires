(function () {

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

  function syncHeaderHeight() {
    const header =
      document.querySelector("header") ||
      document.querySelector(".header") ||
      document.querySelector(".topbar") ||
      document.querySelector(".navbar") ||
      document.querySelector(".nav");

    if (!header) return;
    document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  }

  window.addEventListener("load", syncHeaderHeight);
  window.addEventListener("resize", syncHeaderHeight);

  const obsTarget =
    document.querySelector("header") ||
    document.querySelector(".header") ||
    document.querySelector(".topbar") ||
    document.querySelector(".navbar") ||
    document.querySelector(".nav");

  if (obsTarget && "ResizeObserver" in window) {
    new ResizeObserver(syncHeaderHeight).observe(obsTarget);
  }
})();
