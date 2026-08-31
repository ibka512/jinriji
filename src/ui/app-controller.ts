import type { Course, Item, TimetableData } from "../domain/models";
import { emptyTimetable } from "../domain/timetable";
import { TimetableRepository } from "../data/timetable-repository";
import { CourseController } from "../features/courses/controller";
import { renderTimetable } from "../features/courses/render";
import { DraftStore } from "../data/drafts";
import { AppRepository, SettingsRepository } from "../data/repositories";
import { renderEntries, renderNotes, renderDetail, renderTimeViews, type RenderOptions, type Selection } from "../features/entries/render";
import { EntryEditor } from "../features/entries/editor";
import { BackupController } from "../features/entries/backup-controller";
import { query, queryAll } from "./dom";
import { showToast } from "./toast";
import { applyTheme, isThemeName, type ThemeName } from "./theme";
import { Navigation, type PlanTab, type Route, type ViewName } from "./navigation";
import { dayKey } from "../domain/dates";
import { SegmentedSwitch } from "./segmented-switch";
import { initializeNavigationIcons } from "./navigation-icons";
import { OrganizationController } from "../features/entries/organization-controller";

interface AppState { view: ViewName; theme: ThemeName; items: Item[]; courses: Course[]; timetable: TimetableData }
const UI_KEY = "jinriji:ui:v0.5";

export class AppController {
  readonly editor: EntryEditor;
  private readonly backup: BackupController;
  private readonly navigation: Navigation;
  private readonly segments: SegmentedSwitch;
  private readonly study: CourseController;
  private readonly organization: OrganizationController;
  private readonly options: RenderOptions = { search: "", filter: "all", weekOffset: 0, completedOpen: false, timetable: emptyTimetable(), courseView: { termId: "", week: 0, day: 0 } };
  private lastPlanTab: PlanTab = "week";
  private refreshing?: Promise<void>;
  private readonly pending = new Set<string>();

  constructor(private readonly repository: AppRepository, private readonly settings: SettingsRepository, private readonly state: AppState, timetableRepository: TimetableRepository) {
    this.options.timetable = state.timetable;
    this.organization = new OrganizationController(repository, () => state.items, this.options, () => this.refresh(), () => this.savePreferences());
    this.editor = new EntryEditor(repository, new DraftStore(localStorage), async selection => {
      await this.refresh();
      showToast("已保存", () => this.openDetail(selection), "查看");
    }, () => this.renderDraftBanner());
    this.backup = new BackupController(repository, settings, () => this.refresh());
    this.study = new CourseController(timetableRepository, () => ({ courses: state.courses, data: this.options.timetable, view: this.options.courseView }),
      () => this.refresh(), () => { renderTimetable(state.courses, this.options.timetable, this.options.courseView); this.savePreferences(); },
      id => this.openDetail({ entity: "course", id }));
    this.navigation = new Navigation(state.view, route => this.applyRoute(route), () => {
      if (query<HTMLDialogElement>("#confirm-dialog").open) query<HTMLButtonElement>("#confirm-cancel").click();
      if (this.editor.isOpen) { this.editor.close(true); return !this.editor.isOpen; }
      if (this.study.isOpen) return this.study.dismissFromHistory();
      return !query<HTMLDialogElement>("#confirm-dialog").open;
    });
    this.segments = new SegmentedSwitch(query(".segmented"), value => this.navigation.go({ view: "plan", tab: value as PlanTab }));
  }

  initialize(): void {
    initializeNavigationIcons();
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      if (typeof saved.search === "string") this.options.search = saved.search;
      if (["all", "note", "task", "event"].includes(saved.filter)) this.options.filter = saved.filter;
      this.options.completedOpen = saved.completedOpen === true;
      if (["week", "tasks", "courses"].includes(saved.planTab)) this.lastPlanTab = saved.planTab;
      if (typeof saved.courseTermId === "string") this.options.courseView.termId = saved.courseTermId;
      if (typeof saved.tag === "string") this.options.tag = saved.tag;
      this.options.pinnedOnly = saved.pinnedOnly === true;
    } catch { /* View preferences never prevent loading user records. */ }
    query<HTMLInputElement>("#search-records").value = this.options.search;
    query<HTMLSelectElement>("#record-filter").value = this.options.filter;
    applyTheme(this.state.theme);
    this.render();
    this.editor.setCourses(this.state.courses);
    this.editor.initialize(); this.backup.initialize(); this.study.initialize(); this.organization.initialize();
    this.bindEvents(); this.navigation.initialize();
    void this.run(() => this.backup.renderStatus());
    const refreshWhenVisible = (): void => { if (!document.hidden) void this.run(() => this.refresh()); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("storage", () => this.renderDraftBanner());
    window.setInterval(() => {
      if (!document.hidden && !this.editor.isOpen && !this.study.isOpen && !query<HTMLDialogElement>("#confirm-dialog").open) {
        this.withFocusPreserved(() => renderTimeViews(this.state.items, this.state.courses, this.options));
      }
    }, 60_000);
  }

  private render(): void {
    this.withFocusPreserved(() => renderEntries(this.state.items, this.state.courses, this.options));
    this.renderDraftBanner();
  }

  private refresh(): Promise<void> {
    const next = (this.refreshing || Promise.resolve()).catch(() => undefined).then(async () => {
      const [records, theme] = await Promise.all([this.repository.allRecords(), this.settings.get("theme", "sage")]);
      this.state.items = records.items; this.state.courses = records.courses;
      this.state.timetable = records; this.options.timetable = records; this.editor.setCourses(records.courses);
      this.state.theme = isThemeName(theme) ? theme : "sage";
      applyTheme(this.state.theme); this.render();
      await this.backup.renderStatus();
    });
    this.refreshing = next;
    void next.finally(() => { if (this.refreshing === next) this.refreshing = undefined; }).catch(() => undefined);
    return next;
  }

  private withFocusPreserved(render: () => void): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const attr = active?.hasAttribute("data-entry-check") ? "data-entry-check" : active?.hasAttribute("data-entry-open") ? "data-entry-open" : undefined;
    const id = attr && active ? active.getAttribute(attr) : undefined;
    const parent = active?.closest<HTMLElement>("[data-view-panel]");
    render();
    if (id && attr && active && !active.isConnected && parent) {
      const replacement = Array.from(parent.querySelectorAll<HTMLElement>(`[${attr}]`)).find(element => element.getAttribute(attr) === id && element.getClientRects().length);
      (replacement || parent.querySelector<HTMLElement>("h1"))?.focus({ preventScroll: true });
    }
  }

  private renderDraftBanner(): void {
    try {
      const drafts = this.editor.drafts.list();
      query<HTMLElement>("#draft-banner").hidden = !drafts.length;
      query("#draft-banner-text").textContent = drafts.length > 1 ? `${drafts.length} 份未完成草稿` : "有未完成的草稿";
    } catch {
      query<HTMLElement>("#draft-banner").hidden = false;
      query("#draft-banner-text").textContent = "草稿无法读取，原数据仍保留";
    }
  }

  private savePreferences(): void {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ search: this.options.search, filter: this.options.filter, completedOpen: this.options.completedOpen, planTab: this.lastPlanTab, courseTermId: this.options.courseView.termId, tag: this.options.tag, pinnedOnly: this.options.pinnedOnly })); }
    catch { showToast("界面偏好未能保存，记录不受影响"); }
  }

  private applyRoute(route: Route): void {
    this.organization.resetSelection();
    this.state.view = route.view;
    this.options.selection = route.selection;
    queryAll<HTMLElement>("[data-view-panel]").forEach(panel => panel.classList.toggle("is-active", panel.dataset.viewPanel === route.view));
    queryAll<HTMLElement>("[data-view]").forEach(button => {
      const active = button.dataset.view === route.view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    if (route.view === "plan") this.lastPlanTab = route.tab || this.lastPlanTab;
    this.segments.setValue(this.lastPlanTab);
    queryAll<HTMLElement>("[data-plan-panel]").forEach(panel => panel.classList.toggle("is-active", panel.dataset.planPanel === this.lastPlanTab));
    renderNotes(this.state.items, this.options);
    renderDetail(this.state.items, this.state.courses, route.selection, this.options.timetable);
    const heading = route.selection ? query<HTMLElement>("#detail-title") : query<HTMLElement>(`[data-view-panel="${route.view}"] h1`);
    heading.focus({ preventScroll: true });
    try { localStorage.setItem("jinriji:view", route.view); } catch { /* Navigation remains usable without preferences. */ }
    this.savePreferences();
  }

  private openDetail(selection: Selection): void { this.navigation.go({ view: "notes", selection }); }

  prepareForUpdate(): boolean { return this.study.prepareForUpdate() && this.editor.prepareForUpdate(); }

  private async run(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (cause) { showToast(cause instanceof Error ? cause.message : "操作失败，请重试"); }
  }

  private bindEvents(): void {
    query(".skip-link").addEventListener("click", event => {
      event.preventDefault();
      const main = query<HTMLElement>("#main-content");
      main.tabIndex = -1; main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    document.addEventListener("click", event => void this.run(() => this.handleClick(event)));
    document.addEventListener("change", event => {
      const checkbox = event.target;
      if (!(checkbox instanceof HTMLInputElement) || !checkbox.dataset.entryCheck) return;
      const id = checkbox.dataset.entryCheck;
      if (this.pending.has(id)) return;
      this.pending.add(id); checkbox.disabled = true;
      void this.run(async () => {
        try {
          const current = this.state.items.find(item => item.id === id);
          if (!current) throw new Error("记录已变动，请刷新后重试");
          const completed = checkbox.checked;
          const updated = await this.repository.updateItem(id, { status: completed ? "completed" : "open" }, current.revision);
          await this.refresh();
          showToast(completed ? updated?.repeatNextId ? "已完成，已安排下一次" : "已完成" : "已恢复待办", completed && updated ? () => void this.run(async () => {
            await this.repository.updateItem(id, { status: "open" }, updated.revision); await this.refresh(); showToast("已撤销完成");
          }) : undefined);
        } catch (cause) { checkbox.checked = !checkbox.checked; throw cause; }
        finally { this.pending.delete(id); checkbox.disabled = false; }
      });
    });
    const search = query<HTMLInputElement>("#search-records");
    search.addEventListener("input", () => { this.organization.resetSelection(); this.options.search = search.value; renderNotes(this.state.items, this.options); this.savePreferences(); });
    query<HTMLSelectElement>("#record-filter").addEventListener("change", event => { this.organization.resetSelection(); this.options.filter = (event.currentTarget as HTMLSelectElement).value; renderNotes(this.state.items, this.options); this.savePreferences(); });
    document.addEventListener("toggle", event => {
      if (event.target instanceof HTMLDetailsElement && event.target.hasAttribute("data-completed-group")) {
        this.options.completedOpen = event.target.open; this.savePreferences();
      }
    }, true);
    query(".theme-swatches").addEventListener("keydown", event => this.handleRadioKeys(event as KeyboardEvent, ".theme-dot"));
    document.addEventListener("keydown", event => {
      if (event.isComposing || event.repeat || query<HTMLDialogElement>("#confirm-dialog").open || this.study.isOpen) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); void this.run(async () => this.editor.openNew("note"));
      }
      if (this.editor.isOpen || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && /^Digit[1-4]$/.test(event.code)) {
        event.preventDefault(); const view = (["today", "notes", "plan", "settings"] as ViewName[])[Number(event.code.slice(-1)) - 1]!;
        this.navigation.go({ view, ...(view === "plan" ? { tab: this.lastPlanTab } : {}) }); return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); this.navigation.go({ view: "notes" }); search.focus(); search.select(); }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault(); const type = this.state.view === "plan" ? this.lastPlanTab === "courses" ? "course" : this.lastPlanTab === "tasks" ? "task" : "schedule" : "note";
        void this.run(async () => this.editor.openNew(type));
      }
      if (event.key === "?") {
        event.preventDefault(); this.navigation.go({ view: "settings" }); query<HTMLDetailsElement>("#keyboard-shortcuts").open = true;
        query<HTMLElement>("#keyboard-shortcuts summary").focus();
      }
      if (event.key === "Escape" && this.options.selecting) { this.organization.resetSelection(); renderNotes(this.state.items, this.options); query<HTMLElement>("#organize-toggle").focus(); }
    });
  }

  private handleRadioKeys(event: KeyboardEvent, selector: string): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = queryAll<HTMLButtonElement>(selector);
    const index = buttons.findIndex(button => button === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.click(); buttons[next]?.focus();
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>("button, a.brand");
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    const data = target.dataset;
    if (data.view || data.viewJump || target.matches("a.brand")) {
      event.preventDefault();
      const view = (data.view || data.viewJump || "today") as ViewName;
      this.navigation.go({ view, ...(view === "plan" ? { tab: (data.jumpTab as PlanTab) || this.lastPlanTab } : {}) });
    }
    if (target.hasAttribute("data-open-compose")) {
      const type = data.composeType || (this.state.view === "plan" ? this.lastPlanTab === "courses" ? "course" : this.lastPlanTab === "week" ? "schedule" : "task" : "note");
      this.editor.openNew(type as "note" | "task" | "schedule" | "course", this.state.view === "today" && type !== "note" ? dayKey() : "");
    }
    if (data.courseNote) this.editor.openNew("note", "", data.courseNote);
    if (target.id === "resume-draft") { const draft = this.editor.drafts.list()[0]; if (draft) this.editor.open(draft); }
    if (data.entryOpen) this.openDetail({ id: data.entryOpen, entity: data.entity === "course" ? "course" : "item" });
    if (target.hasAttribute("data-detail-back")) this.navigation.back();
    if (data.entryEdit) {
      const record = data.entity === "course" ? this.state.courses.find(course => course.id === data.entryEdit) : this.state.items.find(item => item.id === data.entryEdit);
      if (record) this.editor.openRecord(record);
    }
    if (data.entryConvert) {
      await this.repository.updateItem(data.entryConvert, { kind: "task", status: "open" }); await this.refresh();
      this.navigation.go({ view: "plan", tab: "tasks" }); showToast("已转为待办");
    }
    const id = data.entryDelete || data.entryRestore;
    if (id && !this.pending.has(id)) {
      this.pending.add(id);
      try {
        const deletedAt = data.entryDelete ? new Date().toISOString() : undefined;
        const course = data.entity === "course";
        if (course) await this.repository.updateCourse(id, { deletedAt }); else await this.repository.updateItem(id, { deletedAt });
        await this.refresh();
        if (data.entryDelete) {
          if (this.options.selection?.id === id) this.navigation.back();
          showToast("已移至最近删除", () => void this.run(async () => {
            if (course) await this.repository.updateCourse(id, { deletedAt: undefined }); else await this.repository.restoreItem(id);
            await this.refresh(); showToast("已恢复");
          }));
        } else showToast("已恢复");
      } finally { this.pending.delete(id); }
    }
    if (data.weekStep !== undefined) {
      this.options.weekOffset = data.weekStep === "0" ? 0 : this.options.weekOffset + Number(data.weekStep);
      renderTimeViews(this.state.items, this.state.courses, this.options);
    }
    if (data.theme && isThemeName(data.theme)) {
      await this.settings.set("theme", data.theme); this.state.theme = data.theme; applyTheme(data.theme);
    }
  }
}
