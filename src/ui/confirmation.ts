import { query } from "./dom";

export async function confirmAction(title: string, message: string, acceptLabel: string, action: () => Promise<void>): Promise<boolean> {
  const dialog = query<HTMLDialogElement>("#confirm-dialog");
  if (dialog.open) return false;
  query("#confirm-title").textContent = title;
  query("#confirm-message").textContent = message;
  const error = query<HTMLElement>("#confirm-error");
  error.hidden = true;
  const accept = query<HTMLButtonElement>("#confirm-accept");
  const cancel = query<HTMLButtonElement>("#confirm-cancel");
  accept.textContent = acceptLabel;
  dialog.showModal();
  cancel.focus();
  return new Promise(resolve => {
    let busy = false;
    const finish = (result: boolean): void => {
      dialog.removeEventListener("cancel", onCancel);
      cancel.onclick = null;
      accept.onclick = null;
      dialog.close();
      resolve(result);
    };
    const onCancel = (event: Event): void => { event.preventDefault(); if (!busy) finish(false); };
    dialog.addEventListener("cancel", onCancel);
    cancel.onclick = () => { if (!busy) finish(false); };
    accept.onclick = () => {
      if (busy) return;
      busy = true;
      accept.disabled = cancel.disabled = true;
      accept.setAttribute("aria-busy", "true");
      accept.textContent = "处理中…";
      void action().then(() => finish(true)).catch((cause: unknown) => {
        error.textContent = cause instanceof Error ? cause.message : "操作失败，请重试";
        error.hidden = false;
      }).finally(() => {
        busy = false;
        accept.disabled = cancel.disabled = false;
        accept.removeAttribute("aria-busy");
        accept.textContent = acceptLabel;
      });
    };
  });
}
