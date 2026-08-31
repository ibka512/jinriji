import { query } from "./dom";

let dismissTimer: number | undefined;

export function showToast(message: string, action?: () => void, actionLabel = "撤销"): void {
  const toast = query<HTMLDivElement>("#toast");
  const toastMessage = query<HTMLSpanElement>("#toast-message");
  const toastAction = query<HTMLButtonElement>("#toast-action");
  toastMessage.textContent = message;
  toastAction.hidden = !action;
  toastAction.textContent = actionLabel;
  toastAction.onclick = action ? () => {
    action();
    toast.classList.remove("is-showing");
  } : null;
  toast.classList.add("is-showing");
  window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => toast.classList.remove("is-showing"), action ? 8000 : 5000);
}
