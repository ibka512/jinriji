import { query } from "./dom";

let dismissTimer: number | undefined;

export function showToast(message: string, action?: () => void): void {
  const toast = query<HTMLDivElement>("#toast");
  const toastMessage = query<HTMLSpanElement>("#toast-message");
  const toastAction = query<HTMLButtonElement>("#toast-action");
  toastMessage.textContent = message;
  toastAction.hidden = !action;
  toastAction.onclick = action ? () => {
    action();
    toast.classList.remove("is-showing");
  } : null;
  toast.classList.add("is-showing");
  window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => toast.classList.remove("is-showing"), 3200);
}
