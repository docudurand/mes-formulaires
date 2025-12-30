(function () {


    
  // DSG_FIXED_LAYOUT_V6 : calcule les hauteurs réelles des barres et positionne le contenu fixe
  function dsgUpdateFixedHeights(){
    const topbar = document.querySelector('.topbar');
    const subbar = document.querySelector('.subbar');

    const topH = topbar ? topbar.getBoundingClientRect().height : 0;
    const subH = subbar ? subbar.getBoundingClientRect().height : 0;

    document.documentElement.style.setProperty('--topbar-h', topH + 'px');
    document.documentElement.style.setProperty('--subbar-h', subH + 'px');
    document.documentElement.style.setProperty('--main-top', (topH + subH) + 'px');
  }

  window.addEventListener('load', dsgUpdateFixedHeights, { once:true });
  window.addEventListener('resize', dsgUpdateFixedHeights);

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