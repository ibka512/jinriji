import type { Selection } from "../features/entries/render";

export type ViewName = "today" | "notes" | "plan" | "settings";
export type PlanTab = "week" | "tasks" | "courses";
export interface Route { view: ViewName; tab?: PlanTab; selection?: Selection; editing?: boolean; newNoteId?: string }

export function parseRoute(hash: string, fallback: ViewName = "today"): Route {
  const [view, tab, encodedId, mode] = hash.replace(/^#/, "").split("/");
  if (view === "notes" && tab === "new" && encodedId) {
    try { return { view: "notes", newNoteId: decodeURIComponent(encodedId) }; } catch { return { view: "notes" }; }
  }
  if (view === "notes" && (tab === "item" || tab === "course") && encodedId) {
    try { return { view: "notes", selection: { entity: tab, id: decodeURIComponent(encodedId) }, ...(mode === "edit" && tab === "item" ? { editing: true } : {}) }; } catch { return { view: "notes" }; }
  }
  if (view === "plan") return { view, tab: tab === "tasks" || tab === "courses" ? tab : "week" };
  return { view: view === "today" || view === "notes" || view === "settings" ? view : fallback };
}

export function routeHash(route: Route): string {
  if (route.newNoteId) return `#notes/new/${encodeURIComponent(route.newNoteId)}`;
  if (route.selection) return `#notes/${route.selection.entity}/${encodeURIComponent(route.selection.id)}${route.editing ? "/edit" : ""}`;
  return route.view === "plan" ? `#plan/${route.tab || "week"}` : `#${route.view}`;
}

export class Navigation {
  route: Route;
  private currentHash: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly scrolls = new Map<string, number>();
  constructor(fallback: ViewName, private readonly onChange: (route: Route) => void | Promise<void>, private readonly dismissOverlay: (fromHistory: boolean) => boolean | Promise<boolean>, private readonly onError: (cause: unknown) => void = console.error) {
    this.route = parseRoute(location.hash, fallback);
    this.currentHash = routeHash(this.route);
  }

  initialize(): void {
    history.scrollRestoration = "manual";
    history.replaceState({ jinriji: true }, "", this.currentHash);
    window.addEventListener("popstate", () => this.request(location.hash, true));
    window.addEventListener("hashchange", () => {
      if (routeHash(parseRoute(location.hash)) !== this.currentHash) this.request(location.hash, true);
    });
    this.queue = Promise.resolve(this.onChange(this.route)).catch(this.onError);
  }

  go(route: Route, replace = false): Promise<void> {
    return this.request(routeHash(route), false, replace);
  }

  back(): void {
    if (history.state?.returnTo) history.back(); else this.go({ view: "notes" });
  }

  private request(hash: string, fromHistory: boolean, replace = false): Promise<void> {
    this.queue = this.queue.then(async () => {
      const next = parseRoute(hash); const normalized = routeHash(next);
      if (normalized === this.currentHash) {
        if (fromHistory && document.querySelector("dialog[open]")) await this.dismissOverlay(true);
        return;
      }
      if (!await this.dismissOverlay(fromHistory)) {
        if (fromHistory) history.replaceState({ jinriji: true }, "", this.currentHash);
        return;
      }
      if (normalized === this.currentHash) return;
      this.scrolls.set(this.currentHash, window.scrollY);
      if (!fromHistory) {
        if (replace) history.replaceState({ ...history.state, jinriji: true }, "", normalized);
        else history.pushState({ jinriji: true, returnTo: this.currentHash }, "", normalized);
      }
      this.route = next; this.currentHash = normalized;
      await this.onChange(next);
      if (!next.editing && !next.newNoteId) requestAnimationFrame(() => window.scrollTo({ top: this.scrolls.get(normalized) || 0, behavior: "instant" }));
    }).catch(this.onError);
    return this.queue;
  }
}
