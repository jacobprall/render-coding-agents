/**
 * Coding Agents service worker.
 *
 * Minimal scope for v1:
 *   - Cache the app shell + static assets for fast repeat loads / install.
 *   - Network-first for HTML and API routes (always show live agent state).
 *   - Cache-first for /icons/ and /_next/static/.
 *
 * Push notification support is intentionally NOT registered here yet.
 * It will require a server-side VAPID infrastructure; see push registration
 * scaffold in /lib/pwa/register-service-worker.ts when ready.
 */

const SHELL_CACHE = "ca-shell-v1";
const SHELL_URLS = [
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ca-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GETs.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Skip Server-Sent Events / streaming requests.
  if (request.headers.get("accept")?.includes("text/event-stream")) return;

  // Static assets: cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API + HTML: network-first with fallback to cache.
  if (
    url.pathname.startsWith("/api/") ||
    request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(networkFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Only cache successful HTML shell responses (status 200).
    if (
      response.ok &&
      response.headers.get("content-type")?.includes("text/html")
    ) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.headers.get("accept")?.includes("text/html")) {
      const fallback = await cache.match("/");
      if (fallback) return fallback;
    }
    throw err;
  }
}

// Future: handle 'push' events here to surface browser notifications.
// self.addEventListener("push", (event) => { ... });
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/sessions";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(target);
            return;
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
