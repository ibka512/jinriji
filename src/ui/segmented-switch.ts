/** UI-001 · Segmented Switch, adapted from ibka512/ibka-ui-designs (MIT).
 * Reference: components/segmented-switch/demo.html. See public/third-party-notices.txt.
 */
export class SegmentedSwitch {
  private readonly items: HTMLButtonElement[];
  private readonly indicator: HTMLElement;
  private value = "";
  private readonly observer: ResizeObserver;
  private frame = 0;

  constructor(private readonly root: HTMLElement, private readonly onChange: (value: string) => void) {
    this.items = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-plan-tab]"));
    this.indicator = root.querySelector<HTMLElement>(".segmented__selection")!;
    root.style.gridTemplateColumns = `repeat(${this.items.length}, minmax(0, 1fr))`;
    root.addEventListener("click", event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-plan-tab]") : null;
      if (item && !item.disabled) this.choose(item, (event as MouseEvent).detail > 0);
    });
    root.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const enabled = this.items.filter(item => !item.disabled);
      const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (current + (event.key === "ArrowLeft" ? -1 : 1) + enabled.length) % enabled.length;
      const next = enabled[index]!;
      this.choose(next, false); next.focus();
    });
    this.observer = new ResizeObserver(() => this.position(false));
    this.observer.observe(root);
  }

  setValue(value: string, animate = false): void {
    if (!this.items.some(item => item.dataset.planTab === value) || this.value === value) return;
    this.value = value;
    this.items.forEach(item => {
      const selected = item.dataset.planTab === value;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    this.position(animate);
  }

  private choose(item: HTMLButtonElement, animate: boolean): void {
    const value = item.dataset.planTab!;
    if (value === this.value) return;
    this.setValue(value, animate); this.onChange(value);
  }

  private position(animate: boolean): void {
    const item = this.items.find(item => item.dataset.planTab === this.value);
    if (!item || !this.root.getClientRects().length) return;
    cancelAnimationFrame(this.frame);
    this.indicator.classList.toggle("no-transition", !animate);
    this.indicator.style.width = `${item.offsetWidth}px`;
    this.indicator.style.transform = `translateX(${item.offsetLeft}px)`;
    this.root.classList.add("is-ready");
    if (!animate) this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => this.indicator.classList.remove("no-transition"));
    });
  }
}
