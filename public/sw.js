/* Go Topic service worker: bounded, same-origin-only caching for a GitHub Pages PWA. */
const CACHE_PREFIX = "gotopik-";
const CACHE_VERSION = "v5";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${CACHE_VERSION}`;
const MAX_ASSET_ENTRIES = 48;
const NAVIGATION_TIMEOUT_MS = 2500;

const BASE_URL = new URL("./", self.registration.scope);
const SHELL_URLS = [
  BASE_URL.href,
  new URL("index.html", BASE_URL).href,
  new URL("manifest.webmanifest", BASE_URL).href,
  new URL("icon-192.png", BASE_URL).href,
  new URL("icon-512.png", BASE_URL).href,
  new URL("icon-maskable.png", BASE_URL).href,
  ...["base.css", "premium.css", "premium.js", "runtime-config.js", "runtime-client.js", "tutor-controller.js", "pcm-worklet.js"].map(path => new URL(path, BASE_URL).href),
];

const STATIC_EXTENSIONS = /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i;
const NEVER_CACHE_PATHS = /(?:^|\/)(?:api|auth|private)(?:\/|$)/i;
const SENSITIVE_QUERY = /(?:^|[&?])(?:token|access_token|id_token|key|auth|session|code|secret|password|credential)=/i;

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNeverCache(url) {
  return (
    NEVER_CACHE_PATHS.test(url.pathname) ||
    SENSITIVE_QUERY.test(url.search) ||
    /(?:^|\/)firebase-config\.js$/i.test(url.pathname) ||
    /(?:^|\/)sw\.js$/i.test(url.pathname)
  );
}

function isStaticAsset(request, url) {
  return (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "font" ||
    STATIC_EXTENSIONS.test(url.pathname)
  );
}

async function cacheSuccessful(cacheName, request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (cacheName !== ASSET_CACHE) return;

  const keys = await cache.keys();
  if (keys.length <= MAX_ASSET_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ASSET_ENTRIES).map((key) => cache.delete(key)));
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function handleNavigation(request) {
  try {
    // Navigation is network-first so users receive the latest site quickly after deploys.
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    // Do not replace server error pages with stale HTML; only cache successful HTML responses.
    if (response.ok) {
      await cacheSuccessful(SHELL_CACHE, new Request(new URL("index.html", BASE_URL).href), response);
    }
    return response;
  } catch (_error) {
    // The offline fallback is intentionally limited to document navigation only.
    const shell = await caches.match(new URL("index.html", BASE_URL).href);
    return shell || caches.match(BASE_URL.href) || Response.error();
  }
}

async function handleStaticAsset(request, event) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      await cacheSuccessful(ASSET_CACHE, request, response);
      return response;
    })
    .catch(() => null);

  // Cache-first with stale-while-revalidate: cached assets render immediately and refresh in the background.
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, ASSET_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        clients.forEach((client) => client.postMessage({ type: "GOTOPIK_SW_UPDATED", version: CACHE_VERSION }));
      })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url) || isNeverCache(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(request, url)) {
    event.respondWith(handleStaticAsset(request, event));
  }
});
