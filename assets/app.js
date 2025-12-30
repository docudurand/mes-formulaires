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

    const ALLOWED_ORIGINS = [
      "https://mes-formulaires.onrender.com",
      "https://durandservicesgarantie.onrender.com",
      "https://docugarantiedurand.odoo.com",
    ];

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    function setFallbackHeight(fr) {
      const vh = window.innerHeight || 900;
      const h = Math.max(900, Math.round(vh * 1.55));
      fr.style.height = h + "px";
    }

    embeds.forEach((fr) => setFallbackHeight(fr));

    function getIframeBySource(sourceWin) {
      return embeds.find((fr) => fr.contentWindow === sourceWin) || null;
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "dsg-iframe-size") return;

      if (event.origin && !ALLOWED_ORIGINS.includes(event.origin)) return;

      const fr = getIframeBySource(event.source);
      if (!fr) return;

      const rawH = Number(data.height);
      if (!Number.isFinite(rawH)) return;

      const h = clamp(Math.round(rawH), 200, 6000);
      fr.dataset.resized = "1";
      fr.style.height = h + "px";
    });

    embeds.forEach((fr) => {
      const request = () => {
        try {
          fr.contentWindow && fr.contentWindow.postMessage({ type: "dsg-iframe-request-size" }, "*");
        } catch (_) {}
      };

      fr.addEventListener("load", () => {
        request();

        let tries = 0;
        const it = setInterval(() => {
          tries += 1;
          request();
          if (tries >= 12 || fr.dataset.resized === "1") clearInterval(it);
        }, 400);
      });

      request();
    });

    let t;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        embeds.forEach((fr) => {
          if (fr.dataset.resized !== "1") setFallbackHeight(fr);
        });
      }, 150);
    });
  }
})();