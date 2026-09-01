/** Input modality is shared by navigation, native overlays and feedback. */
export function initializeMotion(): void {
  document.body.dataset.motionInput = "keyboard";
  document.addEventListener("pointerdown", () => { document.body.dataset.motionInput = "pointer"; }, true);
  document.addEventListener("keydown", () => { document.body.dataset.motionInput = "keyboard"; }, true);
}

export function feedbackDuration(pointer: boolean, reduced: boolean, duration: string): number {
  if (!pointer || reduced) return 0;
  const value = Number.parseFloat(duration);
  return Number.isFinite(value) ? Math.min(160, Math.max(0, value)) : 0;
}

/** Starts concurrently with persistence; never delays a write or an error. */
export function taskFeedback(checkbox: HTMLInputElement): { settled: Promise<void>; clear: () => void } {
  const row = checkbox.closest<HTMLElement>(".task-row");
  const duration = feedbackDuration(document.body.dataset.motionInput === "pointer", matchMedia("(prefers-reduced-motion: reduce)").matches,
    getComputedStyle(document.documentElement).getPropertyValue("--duration-press"));
  row?.setAttribute("aria-busy", "true");
  let timer: number | undefined;
  let finish = (): void => {};
  const settled = new Promise<void>(resolve => { finish = resolve; timer = window.setTimeout(resolve, duration); });
  return { settled, clear: () => { window.clearTimeout(timer); finish(); row?.removeAttribute("aria-busy"); } };
}
