import { query } from "./dom";

let dismissTimer: number | undefined;
let hideTimer: number | undefined;
let generation = 0;
let listeners: AbortController | undefined;
let returnFocus: HTMLElement | null = null;

export function showToast(message: string, action?: () => void, actionLabel = "撤销"): void {
  const toast = query<HTMLDivElement>("#toast");
  const button = query<HTMLButtonElement>("#toast-action");
  if (!toast.contains(document.activeElement)) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let close = toast.querySelector<HTMLButtonElement>("#toast-dismiss");
  if (!close) {
    close = document.createElement("button"); close.id = "toast-dismiss"; close.type = "button"; close.setAttribute("aria-label", "关闭提示");
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>'; toast.append(close);
  }
  const current = ++generation;
  listeners?.abort(); listeners = new AbortController();
  window.clearTimeout(dismissTimer); window.clearTimeout(hideTimer);
  const dismiss = (): void => {
    if (current !== generation) return;
    window.clearTimeout(dismissTimer);
    if (toast.contains(document.activeElement)) {
      const target = returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest("details:not([open]),[hidden],[inert]") ? returnFocus
        : document.querySelector<HTMLElement>('[data-view-panel].is-active h1');
      target?.focus({ preventScroll: true });
    }
    toast.inert = true; toast.classList.remove("is-showing"); button.onclick = null;
    hideTimer = window.setTimeout(() => { if (current === generation) toast.hidden = true; }, 240);
  };
  query("#toast-message").textContent = message;
  button.hidden = !action; button.textContent = actionLabel;
  // Retire the old notification BEFORE its action may show a new one.
  button.onclick = action ? () => { dismiss(); action(); } : null;
  close.onclick = dismiss;
  toast.hidden = false; toast.inert = false; toast.classList.add("is-showing");
  const schedule = (): void => {
    window.clearTimeout(dismissTimer);
    if (toast.matches(":hover") || toast.contains(document.activeElement)) return;
    dismissTimer = window.setTimeout(dismiss, action ? 8000 : 5000);
  };
  for (const name of ["pointerenter", "focusin"]) toast.addEventListener(name, () => window.clearTimeout(dismissTimer), { signal: listeners.signal });
  for (const name of ["pointerleave", "focusout"]) toast.addEventListener(name, schedule, { signal: listeners.signal });
  toast.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } }, { signal: listeners.signal });
  schedule();
}
