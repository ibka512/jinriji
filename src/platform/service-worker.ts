import { showToast } from "../ui/toast";

function offerUpdate(registration: ServiceWorkerRegistration, onAccept: () => boolean): void {
  if (!registration.waiting) return;
  const status = document.querySelector("#app-update-status");
  const button = document.querySelector<HTMLButtonElement>("#check-update");
  const apply = (): void => {
    if (!onAccept()) return;
    if (status) status.textContent = "正在更新，记录仍保存在本机…";
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
  if (status) status.textContent = "新版本已就绪，完成当前编辑后即可更新。";
  if (button) { button.disabled = false; button.textContent = "立即更新"; button.onclick = apply; }
  showToast("新版本已经准备好", apply, "更新");
}

export function registerServiceWorker(prepareForUpdate: () => boolean = () => true): void {
  const status = document.querySelector("#app-update-status");
  const button = document.querySelector<HTMLButtonElement>("#check-update");
  const report = (text: string): void => { if (status) status.textContent = text; };
  if (!("serviceWorker" in navigator)) { report("此浏览器不支持离线更新，请刷新页面获取新版本。"); if (button) button.hidden = true; return; }
  if (import.meta.env.DEV) {
    report("本地开发预览，修改会自动刷新。"); if (button) button.hidden = true;
    // A previous preview worker must not serve stale source modules during HMR.
    void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then(registration => registration?.unregister()).catch(() => undefined);
    return;
  }
  let reloadRequested = false;
  const register = (): void => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      const accept = (): boolean => { if (!prepareForUpdate()) return false; reloadRequested = true; return true; };
      const check = async (): Promise<void> => {
        if (navigator.onLine === false) { report("当前离线，请联网后重试。记录不受影响。"); offerUpdate(registration, accept); return; }
        if (button) button.disabled = true; report("正在检查更新…");
        try {
          await registration.update();
          report(registration.installing ? "正在下载更新，准备好后会提醒。" : "已检查，当前没有可用更新。");
        } catch { report("暂时无法检查更新，请联网后重试。记录不受影响。"); }
        finally { if (button) button.disabled = false; offerUpdate(registration, accept); }
      };
      if (button) button.onclick = () => { void check(); };
      offerUpdate(registration, accept);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(registration, accept);
          } else if (installing.state === "redundant") {
            report("更新下载未完成，当前版本仍可使用，请重试。");
            if (button) { button.disabled = false; button.textContent = "重试更新"; button.onclick = () => { void check(); }; }
          }
        });
      });
      void check();
    }).catch((error: unknown) => { report("更新服务暂不可用，可重试；记录不受影响。"); if (button) button.onclick = register; console.warn("Service Worker 注册失败", error); });
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
