(() => {
  "use strict";

  const THEME_KEY = "gotopic-theme";
  const HOME_ART = "/manus-storage/async-images/4vzI5sf6VBdAmnp65tFPyA/image-1.webp";
  const routeName = () => (location.hash || "#bosh").slice(1) || "bosh";
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const safeStore = (method, key, value) => {
    try {
      if (method === "get") return localStorage.getItem(key);
      if (method === "remove") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_) {}
    return null;
  };

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
    ].map(([route, icon, label]) => route === "menu"
      ? `<button type="button" data-ui-open-menu aria-label="Menyuni ochish"><b aria-hidden="true">${icon}</b><span>${label}</span></button>`
      : `<a href="#${route}" data-mobile-route="${route}"><b aria-hidden="true">${icon}</b><span>${label}</span></a>`).join("");
    document.body.appendChild(nav);
  }

  function syncNavigation(route) {
    document.querySelectorAll("#nav a, .mobile-nav a[data-mobile-route]").forEach((link) => {
      const active = link.getAttribute("href") === `#${route}`;
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
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
        <div class="home-ai-footer"><span>TOPIK 1—5 uchun</span><span>Ovoz · Matn · Feedback</span></div>
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
      if (actions) { actions.classList.add("home-actions"); copy.appendChild(actions); }
      hero.replaceChildren(copy, makeAiCard());
    }
    const stats = view.querySelector(":scope > .stats");
    if (stats) {
      stats.insertAdjacentHTML("beforebegin", '<div class="home-focus"><small>Bugungi ritm</small><strong>Bir kichik qadam — katta natija.</strong><p>Darajangizni saqlang, ketma-ket kunlarni davom ettiring va keyingi mashqni oson boshlang.</p><div class="focus-progress"><span>Progress</span><div class="bar" aria-hidden="true"><i style="width:100%"></i></div><span aria-hidden="true">→</span></div></div>');
      const current = lvlInfo(S.xp);
      const bar = view.querySelector(".home-focus .bar i");
      if (bar) bar.style.width = `${Math.min(100, current.cur / current.need * 100)}%`;
    }
  }

  function decorateView() {
    const view = document.querySelector("#app > .view");
    if (!view) return;
    const route = routeName();
    view.dataset.route = route;
    if (route === "bosh") decorateHome(view);
    syncNavigation(route);
    window.GoTopicAccountRefresh?.();
  }

  function ripple(event) {
    if (reduceMotion()) return;
    const target = event.target.closest("button,a,[role=button],summary");
    if (!target || target.matches("[disabled],.mobile-nav button")) return;
    const previous = target.querySelector(":scope > .ripple-ink");
    if (previous) previous.remove();
    const dot = document.createElement("i");
    dot.className = "ripple-ink";
    const rect = target.getBoundingClientRect();
    dot.style.left = `${event.clientX - rect.left}px`;
    dot.style.top = `${event.clientY - rect.top}px`;
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
    applyTheme(saved || "dark");
    addThemeControl();
    buildMobileNav();
    document.addEventListener("click", (event) => {
      const theme = event.target.closest("[data-theme-toggle]");
      if (theme) {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        safeStore("set", THEME_KEY, next);
        applyTheme(next);
        return;
      }
      const menu = event.target.closest("[data-ui-open-menu]");
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
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.getElementById("burger")?.addEventListener("click", () => requestAnimationFrame(drawerFocusTrap));

    const originalRender = window.render;
    if (typeof originalRender === "function") {
      window.render = function premiumRender(...args) {
        const result = originalRender.apply(this, args);
        decorateView();
        return result;
      };
      window.GoTopicUI = { refresh: decorateView, theme: applyTheme };
    }
    decorateView();
    window.addEventListener("hashchange", () => requestAnimationFrame(decorateView), { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
