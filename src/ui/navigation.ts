import type { Selection } from "../features/entries/render";

export type ViewName = "today" | "notes" | "plan" | "settings";
export type PlanTab = "week" | "tasks" | "courses";
export interface Route { view: ViewName; tab?: PlanTab; selection?: Selection }

export function parseRoute(hash: string, fallback: ViewName = "today"): Route {
  const [view, tab, encodedId] = hash.replace(/^#/, "").split("/");
  if (view === "notes" && (tab === "item" || tab === "course") && encodedId) {
    try { return { view: "notes", selection: { entity: tab, id: decodeURIComponent(encodedId) } }; } catch { return { view: "notes" }; }
  }
  if (view === "plan") return { view, tab: tab === "tasks" || tab === "courses" ? tab : "week" };
  return { view: view === "today" || view === "notes" || view === "settings" ? view : fallback };
}

export function routeHash(route: Route): string {
  if (route.selection) return `#notes/${route.selection.entity}/${encodeURIComponent(route.selection.id)}`;
  return route.view === "plan" ? `#plan/${route.tab || "week"}` : `#${route.view}`;
}

export class Navigation {
  route: Route;
  private currentHash: string;
  private readonly scrolls = new Map<string, number>();
  constructor(fallback: ViewName, private readonly onChange: (route: Route) => void, private readonly dismissOverlay: () => boolean) {
    this.route = parseRoute(location.hash, fallback);
    this.currentHash = routeHash(this.route);
  }

  initialize(): void {
    history.scrollRestoration = "manual";
    history.replaceState({ jinriji: true }, "", this.currentHash);
    window.addEventListener("popstate", () => {
      if (!this.dismissOverlay()) {
        history.pushState({ jinriji: true, jinrijiModal: "editor" }, "", this.currentHash); return;
      }
      this.apply(location.hash);
    });
    window.addEventListener("hashchange", () => {
      if (routeHash(parseRoute(location.hash)) !== this.currentHash) this.apply(location.hash);
    });
    this.onChange(this.route);
  }

  go(route: Route): void {
    const hash = routeHash(route);
    if (hash === this.currentHash) return;
    history.pushState({ jinriji: true, returnTo: this.currentHash }, "", hash);
    this.apply(hash);
  }

  back(): void {
    if (history.state?.returnTo) history.back(); else this.go({ view: "notes" });
  }

  private apply(hash: string): void {
    const next = parseRoute(hash);
    const normalized = routeHash(next);
    if (normalized === this.currentHash) return;
    this.scrolls.set(this.currentHash, window.scrollY);
    this.route = next; this.currentHash = normalized;
    this.onChange(next);
    requestAnimationFrame(() => window.scrollTo({ top: this.scrolls.get(normalized) || 0, behavior: "instant" }));
  }
}
