import { showToast } from "../ui/toast";

function offerUpdate(registration: ServiceWorkerRegistration, onAccept: () => boolean): void {
  if (!registration.waiting) return;
  showToast("新版本已经准备好", () => {
    if (!onAccept()) return;
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  }, "更新");
}

export function registerServiceWorker(prepareForUpdate: () => boolean = () => true): void {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) {
    // A previous preview worker must not serve stale source modules during HMR.
    void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then(registration => registration?.unregister()).catch(() => undefined);
    return;
  }
  let reloadRequested = false;
  const register = (): void => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      offerUpdate(registration, () => { if (!prepareForUpdate()) return false; reloadRequested = true; return true; });
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(registration, () => { if (!prepareForUpdate()) return false; reloadRequested = true; return true; });
          }
        });
      });
      void registration.update().catch((error: unknown) => console.warn("暂时无法检查更新", error));
    }).catch((error: unknown) => console.warn("Service Worker 注册失败", error));
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadRequested || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
