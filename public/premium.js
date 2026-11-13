(() => {
  "use strict";

  const THEME_KEY = "gotopic-theme";
  const HOME_ART = "/manus-storage/async-images/4vzI5sf6VBdAmnp65tFPyA/image-1.webp";
  const ROUTE_PALETTE = [
    ["#7c5cff", "#2e8dff", "#25d5ad"], ["#ef688f", "#865dff", "#ffbd69"],
    ["#ffb83e", "#ef6f81", "#805dff"], ["#f06b96", "#ff9d61", "#735cff"],
    ["#2a9dff", "#725cff", "#21cfa5"], ["#23cdb4", "#328fff", "#8b63ff"],
    ["#f36eaa", "#865cff", "#30a4ff"], ["#775fff", "#2b9fff", "#f2bd52"]
  ];
  let lastRoute = null;

  const routeName = () => {
    try {
      if (typeof route === "function") return route();
    } catch (_) {}
    return (location.hash || "#bosh").slice(1) || "bosh";
  };
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const safeStore = (method, key, value) => {
    try {
      if (method === "get") return localStorage.getItem(key);
      if (method === "remove") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_) {}
    return null;
  };

  function setRouteAccent(route) {
    let hash = 0;
    for (let i = 0; i < route.length; i += 1) hash = (hash * 31 + route.charCodeAt(i)) >>> 0;
    const [a, b, c] = ROUTE_PALETTE[hash % ROUTE_PALETTE.length];
    const root = document.documentElement;
    root.style.setProperty("--route-a", a);
    root.style.setProperty("--route-b", b);
    root.style.setProperty("--route-c", c);
  }

  function applyTheme(theme) {
    const chosen = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = chosen;
    const toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(chosen === "light"));
      toggle.setAttribute("aria-label", chosen === "light" ? "Qorong'i rejim" : "Yorug' rejim");
      toggle.title = chosen === "light" ? "Qorong'i rejim" : "Yorug' rejim";
    }
  }

  function addThemeControl() {
    const wrap = document.querySelector("header.top .wrap");
    if (!wrap || wrap.querySelector("[data-theme-toggle]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.dataset.themeToggle = "";
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = '<span class="moon" aria-hidden="true">☾</span><span class="sun" aria-hidden="true">☼</span>';
    const xp = wrap.querySelector("#xp");
    wrap.insertBefore(button, xp || wrap.querySelector(".grow"));
    applyTheme(document.documentElement.dataset.theme || safeStore("get", THEME_KEY) || "dark");
  }

  function buildMobileNav() {
    if (document.querySelector(".mobile-nav")) return;
    const nav = document.createElement("nav");
    nav.className = "mobile-nav";
    nav.setAttribute("aria-label", "Tezkor navigatsiya");
    nav.innerHTML = [
      ["bosh", "⌂", "Bosh sahifa"],
      ["reja", "◒", "Reja"],
      ["sozlar", "가", "So'zlar"],
      ["suhbat", "◌", "AI suhbat"],
      ["menu", "☰", "Menyu"]
    ].map(([routeKey, icon, label]) => routeKey === "menu"
      ? `<button type="button" data-ui-open-menu aria-label="Menyuni ochish"><b aria-hidden="true">${icon}</b><span>${label}</span></button>`
      : `<a href="#${routeKey}" data-mobile-route="${routeKey}"><b aria-hidden="true">${icon}</b><span>${label}</span></a>`).join("");
    document.body.appendChild(nav);
  }

  function syncNavigation(route) {
    document.querySelectorAll("#nav a, .mobile-nav a[data-mobile-route]").forEach((link) => {
      const active = link.getAttribute("href") === `#${route}`;
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function drawerProgress() {
    const drawer = document.getElementById("drawer");
    if (!drawer || drawer.querySelector("[data-drawer-progress]")) return;
    const progress = document.createElement("div");
    progress.className = "drawer-progress";
    progress.dataset.drawerProgress = "";
    progress.innerHTML = '<div class="drawer-progress-top"><span>O\'quv darajasi</span><strong data-drawer-level>TOPIK 1</strong></div><div class="drawer-progress-row"><span class="drawer-progress-badge" aria-hidden="true">XP</span><div><b data-drawer-xp>0 XP</b><small>Bugungi o\'sish ritmi</small></div></div>';
    drawer.querySelector(".dhead")?.insertAdjacentElement("afterend", progress);
  }

  function updateDrawerProgress() {
    const drawer = document.getElementById("drawer");
    if (!drawer) return;
    const xp = document.getElementById("xp");
    const xpText = xp ? xp.textContent.trim() : "0 XP";
    const xpNode = drawer.querySelector("[data-drawer-xp]");
    if (xpNode) xpNode.textContent = xpText;
    let level = 1;
    try {
      if (typeof S !== "undefined" && Number.isFinite(Number(S.lvl))) level = Number(S.lvl);
    } catch (_) {}
    const levelNode = drawer.querySelector("[data-drawer-level]");
    if (levelNode) levelNode.textContent = `TOPIK ${level}`;
  }

  function makeAiCard() {
    const card = document.createElement("article");
    card.className = "home-ai-card";
    card.dataset.uiAiCard = "";
    card.innerHTML = `
      <div class="home-ai-art" role="img" aria-label="Go Topic AI ustozining yorqin aurora illyustratsiyasi"></div>
      <div class="ai-orbit" aria-hidden="true"></div>
      <div class="home-ai-inner">
        <div class="home-ai-top"><span class="home-ai-label">AI ustoz</span><span class="ai-status">Tayyor</span></div>
        <div class="home-ai-content"><h2>Tilni gapirib o'rganing.</h2><p>Har bir javobingizni o'zbekcha izoh, koreyscha talaffuz va muloyim tuzatish bilan mashq qiling.</p><a class="btn" href="#suhbat">Suhbatni boshlash <span aria-hidden="true">↗</span></a></div>
        <div class="home-ai-footer"><span>TOPIK 1—6 uchun</span><span>Ovoz · Matn · Feedback</span></div>
      </div>`;
    card.querySelector(".home-ai-art").style.backgroundImage = `linear-gradient(180deg,transparent 20%,rgba(11,18,47,.86) 86%),url('${HOME_ART}')`;
    return card;
  }

  function decorateHome(view) {
    if (!view || view.dataset.uiHomeReady === "true") return;
    view.dataset.uiHomeReady = "true";
    view.classList.add("home-view");
    const hero = view.querySelector(".hero2");
    if (hero) {
      hero.classList.add("home-hero");
      const copy = document.createElement("div");
      copy.className = "home-hero-copy";
      const nodes = Array.from(hero.children);
      const score = nodes.find((node) => node.classList.contains("score"));
      const heading = nodes.find((node) => node.matches("h1"));
      const lead = nodes.find((node) => node.classList.contains("lead"));
      const actions = nodes.find((node) => node.classList.contains("col"));
      if (score) score.remove();
      if (heading) heading.remove();
      if (lead) lead.remove();
      if (actions) actions.remove();
      copy.innerHTML = '<span class="eyebrow">Koreys tili · O\'zbekcha platforma</span>';
      if (heading) copy.appendChild(heading);
      if (lead) copy.appendChild(lead);
      if (actions) {
        actions.classList.add("home-actions");
        copy.appendChild(actions);
      }
      hero.replaceChildren(copy, makeAiCard());
    }
    const stats = view.querySelector(":scope > .stats");
    if (stats) {
      stats.insertAdjacentHTML("beforebegin", '<div class="home-focus"><small>Bugungi ritm</small><strong>Bir kichik qadam — katta natija.</strong><p>Darajangizni saqlang, ketma-ket kunlarni davom ettiring va keyingi mashqni oson boshlang.</p><div class="focus-progress"><span>Progress</span><div class="bar" aria-hidden="true"><i style="width:100%"></i></div><span aria-hidden="true">→</span></div></div>');
      try {
        const current = typeof lvlInfo === "function" && typeof S !== "undefined" ? lvlInfo(S.xp) : null;
        const bar = view.querySelector(".home-focus .bar i");
        if (bar && current) bar.style.width = `${Math.min(100, current.cur / current.need * 100)}%`;
      } catch (_) {}
    }
  }

  function decorateView() {
    const route = routeName();
    const view = document.querySelector("#app > .view");
    setRouteAccent(route);
    document.documentElement.dataset.route = route;
    if (view) {
      view.dataset.route = route;
      if (route === "bosh") decorateHome(view);
    }
    updateDrawerProgress();
    if (route !== lastRoute) {
      syncNavigation(route);
      lastRoute = route;
    }
    window.GoTopicAccountRefresh?.();
  }

  function ripple(event) {
    if (reduceMotion() || !(event.target instanceof Element)) return;
    const target = event.target.closest("button,a,[role=button],summary");
    if (!target || target.matches("[disabled]")) return;
    const previous = target.querySelector(":scope > .ripple-ink");
    if (previous) previous.remove();
    const dot = document.createElement("i");
    dot.className = "ripple-ink";
    const rect = target.getBoundingClientRect();
    dot.style.left = `${event.clientX - rect.left}px`;
    dot.style.top = `${event.clientY - rect.top}px`;
    const remove = () => dot.remove();
    dot.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 700);
    target.appendChild(dot);
  }

  function drawerFocusTrap() {
    const drawer = document.getElementById("drawer");
    if (!drawer || drawer.hidden) return;
    const focusables = drawer.querySelectorAll("a,button,[tabindex]:not([tabindex='-1'])");
    if (focusables.length) focusables[0].focus({ preventScroll: true });
  }

  function init() {
    const saved = safeStore("get", THEME_KEY);
    applyTheme(saved || document.documentElement.dataset.theme || "dark");
    addThemeControl();
    buildMobileNav();
    drawerProgress();
    document.addEventListener("click", (event) => {
      const theme = event.target.closest?.("[data-theme-toggle]");
      if (theme) {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        safeStore("set", THEME_KEY, next);
        applyTheme(next);
        return;
      }
      const menu = event.target.closest?.("[data-ui-open-menu]");
      if (menu) {
        const burger = document.getElementById("burger");
        if (burger) burger.click();
        requestAnimationFrame(drawerFocusTrap);
      }
    });
    document.addEventListener("pointerdown", ripple, { passive: true });
    document.addEventListener("keydown", (event) => {
      const drawer = document.getElementById("drawer");
      if (event.key === "Escape" && drawer && !drawer.hidden) {
        const close = document.getElementById("dclose");
        if (close) close.click();
        else drawer.hidden = true;
        return;
      }
      if (event.key !== "Tab" || !drawer || drawer.hidden) return;
      const focusables = Array.from(drawer.querySelectorAll("a,button,[tabindex]:not([tabindex='-1'])"));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.getElementById("burger")?.addEventListener("click", () => requestAnimationFrame(drawerFocusTrap));

    const originalRender = window.render;
    if (typeof originalRender === "function" && !window.__gotopicPremiumWrapped) {
      window.__gotopicPremiumWrapped = true;
      window.render = function premiumRender(...args) {
        const result = originalRender.apply(this, args);
        decorateView();
        return result;
      };
    }
    window.GoTopicUI = { refresh: decorateView, theme: applyTheme };
    decorateView();
    window.addEventListener("hashchange", decorateView, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
