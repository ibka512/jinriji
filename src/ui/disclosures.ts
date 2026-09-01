/** Native details keep keyboard semantics; shared dismissal never changes form values. */
export function initializeDisclosures(): void {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Node)) return;
    document.querySelectorAll<HTMLDetailsElement>(".disclosure-menu[open],.writer-more[open]").forEach(menu => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const menu = (event.target as Element)?.closest<HTMLDetailsElement>(".disclosure-menu[open]");
    if (menu) { event.preventDefault(); menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); }
  });
  // A dismissed menu must not retain a keyboard stop during its visual exit.
  const sync = (menu: Element): void => {
    if (!(menu instanceof HTMLDetailsElement) || !menu.matches(".disclosure-menu,.writer-more")) return;
    const panel = menu.querySelector<HTMLElement>(".disclosure-panel,.writer-tools");
    if (panel) panel.inert = !menu.open;
  };
  document.querySelectorAll(".disclosure-menu,.writer-more").forEach(sync);
  new MutationObserver(changes => changes.forEach(change => sync(change.target as Element)))
    .observe(document.body, { attributes:true, attributeFilter:["open"], subtree:true });
  document.addEventListener("focusin", event => {
    if (!(event.target instanceof Node)) return;
    document.querySelectorAll<HTMLDetailsElement>(".disclosure-menu[open],.writer-more[open]").forEach(menu => {
      if (!menu.contains(event.target as Node)) menu.open = false;
    });
  });
}
