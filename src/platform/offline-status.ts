export function initializeOfflineStatus(): void {
  const update = (): void => {
    const offline = !navigator.onLine;
    const controlled = !import.meta.env.DEV && Boolean(navigator.serviceWorker?.controller);
    document.querySelector<HTMLElement>("#offline-banner")!.hidden = !offline;
    document.querySelector("#sidebar-storage-status")!.textContent = offline ? "离线 · 本地保存" : "本地保存";
    document.querySelector("#network-status")!.textContent = offline ? "当前离线" : "本地优先";
    document.querySelector("#offline-readiness")!.textContent = import.meta.env.DEV ? "开发预览不缓存离线页面。" : controlled
      ? "离线页面已就绪，可断网继续使用。" : "离线页面尚未就绪，请保持页面打开后再检查。";
    document.querySelector("#offline-banner")!.textContent = controlled ? "当前离线，可继续编辑" : "当前离线，可继续编辑；页面尚未缓存，请勿关闭";
  };
  window.addEventListener("online", update); window.addEventListener("offline", update);
  navigator.serviceWorker?.addEventListener("controllerchange", update);
  update();
}
