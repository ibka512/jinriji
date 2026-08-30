import { showToast } from "../ui/toast";

function offerUpdate(registration: ServiceWorkerRegistration): void {
  if (!registration.waiting) return;
  showToast("新版本已经准备好", () => registration.waiting?.postMessage({ type: "SKIP_WAITING" }));
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const register = (): void => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      offerUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) offerUpdate(registration);
        });
      });
      void registration.update();
    }).catch((error: unknown) => console.warn("Service Worker 注册失败", error));
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
