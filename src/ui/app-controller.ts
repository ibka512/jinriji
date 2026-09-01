import type { Course, Item, TimetableData, LibraryData } from "../domain/models";
import type { Draft } from "../data/drafts";
import { LibraryRepository } from "../data/library-repository";
import { LibraryController } from "../features/entries/library-controller";
import { cacheImages, hydrateImages } from "../features/entries/local-images";
import { emptyTimetable } from "../domain/timetable";
import { TimetableRepository } from "../data/timetable-repository";
import { CourseController } from "../features/courses/controller";
import { renderTimetable } from "../features/courses/render";
import { IndexedDraftStore } from "../data/indexed-drafts";
import { WritingRepository } from "../data/writing-repository";
import { AppRepository, SettingsRepository } from "../data/repositories";
import { renderEntries, renderNotes, renderDetail, renderTimeViews, type RenderOptions, type Selection } from "../features/entries/render";
import { EntryEditor } from "../features/entries/editor";
import { BackupController } from "../features/entries/backup-controller";
import { query, queryAll } from "./dom";
import { showToast } from "./toast";
import { applyTheme, isThemeName, type ThemeName } from "./theme";
import { Navigation, type PlanTab, type Route, type ViewName } from "./navigation";
import { dayKey, startOfWeek } from "../domain/dates";
import { SegmentedSwitch } from "./segmented-switch";
import { initializeNavigationIcons } from "./navigation-icons";
import { OrganizationController } from "../features/entries/organization-controller";
import { taskFeedback } from "./motion";

interface AppState { view: ViewName; theme: ThemeName; items: Item[]; courses: Course[]; timetable: TimetableData; library: LibraryData }
const UI_KEY = "jinriji:ui:v0.5";

export class AppController {
  readonly editor: EntryEditor;
  private readonly backup: BackupController;
  private readonly navigation: Navigation;
  private readonly segments: SegmentedSwitch;
  private readonly study: CourseController;
  private readonly organization: OrganizationController;
  private readonly library: LibraryController;
  private readonly requestedNotes = new Map<string, { draft: Draft; recovered: boolean }>();
  private readonly options: RenderOptions = { search: "", filter: "all", weekOffset: 0, completedOpen: false, timetable: emptyTimetable(), courseView: { termId: "", week: 0, day: 0 } };
  private lastPlanTab: PlanTab = "week";
  private refreshing?: Promise<void>;
  private readonly pending = new Set<string>();

  constructor(private readonly repository: AppRepository, private readonly settings: SettingsRepository, private readonly state: AppState, timetableRepository: TimetableRepository, drafts: IndexedDraftStore, writing: WritingRepository, libraryRepository: LibraryRepository) {
    this.options.timetable = state.timetable;
    this.organization = new OrganizationController(repository, () => state.items, this.options, () => this.refresh(), () => this.savePreferences());
    this.editor = new EntryEditor(repository, drafts, async selection => {
      await this.refresh();
      if (selection.entity === "course" || state.items.find(item => item.id === selection.id)?.kind !== "note") showToast("已保存", () => this.openDetail(selection), "查看");
    }, () => void this.renderDraftBanner(), writing, libraryRepository);
    this.library = new LibraryController(libraryRepository, () => state.library.notebooks, this.options, () => this.refresh(), draft => this.editor.open(draft, false), () => { this.organization.resetSelection(); renderNotes(state.items, this.options); this.savePreferences(); });
    this.backup = new BackupController(repository, settings, () => this.refresh());
    this.study = new CourseController(timetableRepository, () => ({ courses: state.courses, data: this.options.timetable, view: this.options.courseView }),
      () => this.refresh(), () => { renderTimetable(state.courses, this.options.timetable, this.options.courseView); this.savePreferences(); },
      id => this.openDetail({ entity: "course", id }));
    this.navigation = new Navigation(state.view, route => this.applyRoute(route), async fromHistory => {
      if (query<HTMLDialogElement>("#confirm-dialog").open) query<HTMLButtonElement>("#confirm-cancel").click();
      if (this.editor.isPage) { if (!await this.editor.leavePage()) return false; await this.refresh(); }
      else if (this.editor.isOpen) { await this.editor.close(fromHistory); return !this.editor.isOpen; }
      if (this.study.isOpen) return this.study.dismissFromHistory();
      return !query<HTMLDialogElement>("#confirm-dialog").open;
    }, cause => showToast(cause instanceof Error ? cause.message : "切换失败，内容仍保留"));
    this.editor.onPageRequest = (draft, recovered) => {
      if (!draft.entity && !draft.notebookId && this.options.notebookId && this.options.notebookId !== "unfiled") draft = { ...draft, notebookId: this.options.notebookId };
      this.requestedNotes.set(draft.id!, { draft, recovered });
      this.navigation.go(draft.revision === undefined ? { view: "notes", newNoteId: draft.id } : { view: "notes", selection: { entity: "item", id: draft.id! }, editing: true }, draft.revision !== undefined && this.navigation.route.selection?.id === draft.id);
    };
    this.editor.onPageDone = (id, scroll = 0) => { const route: Route = id ? { view: "notes", selection: { entity: "item", id } } : { view: "notes" }; this.navigation.rememberScroll(route, scroll); void this.navigation.go(route, true); };
    this.editor.onNoteCommitted = item => {
      const index = state.items.findIndex(record => record.id === item.id);
      if (index < 0) state.items.unshift(item); else state.items[index] = item;
      this.options.selection = { entity: "item", id: item.id }; this.editor.setNotes(state.items);
      renderNotes(state.items, this.options);
      query("#sidebar-count").textContent = `${state.items.filter(item => !item.deletedAt).length} 条记录`;
    };
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
      if (typeof saved.notebookId === "string") this.options.notebookId = saved.notebookId;
      if (["updated", "created", "title"].includes(saved.sort)) this.options.sort = saved.sort;
    } catch { /* View preferences never prevent loading user records. */ }
    query<HTMLInputElement>("#search-records").value = this.options.search;
    query<HTMLSelectElement>("#record-filter").value = this.options.filter;
    query<HTMLSelectElement>("#record-sort").value = this.options.sort || "updated";
    applyTheme(this.state.theme);
    this.render();
    this.editor.setCourses(this.state.courses);
    this.editor.setNotebooks(this.state.library.notebooks); this.editor.setNotes(this.state.items); cacheImages(this.state.library.assets);
    this.editor.initialize(); this.backup.initialize(); this.study.initialize(); this.organization.initialize(); this.library.initialize();
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
      this.state.library = records; cacheImages(records.assets); this.editor.setNotebooks(records.notebooks); this.editor.setNotes(records.items); this.library.render();
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
    const visible = (element: HTMLElement): boolean => Boolean(element.getClientRects().length) && !element.closest("details:not([open]),[hidden],[inert]");
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const attr = active?.hasAttribute("data-entry-check") ? "data-entry-check" : active?.hasAttribute("data-entry-open") ? "data-entry-open" : undefined;
    const id = attr && active ? active.getAttribute(attr) : undefined;
    const parent = active?.closest<HTMLElement>("[data-view-panel]");
    const peers = parent ? Array.from(parent.querySelectorAll<HTMLElement>("[data-entry-check]")).filter(visible) : [];
    const index = peers.indexOf(active!);
    const neighbourIds = index < 0 ? [] : [...peers.slice(index + 1), ...peers.slice(0, index).reverse()].map(element => element.getAttribute("data-entry-check"));
    render();
    if (id && attr && active && !active.isConnected && parent) {
      const replacement = Array.from(parent.querySelectorAll<HTMLElement>(`[${attr}]`)).find(element => element.getAttribute(attr) === id && visible(element));
      const checks = Array.from(parent.querySelectorAll<HTMLElement>("[data-entry-check]"));
      const neighbour = neighbourIds.map(id => checks.find(element => element.getAttribute("data-entry-check") === id && visible(element))).find(Boolean);
      (replacement || neighbour || parent.querySelector<HTMLElement>("h1"))?.focus({ preventScroll: true });
    }
  }

  private async renderDraftBanner(): Promise<void> {
    try {
      const drafts = await this.editor.drafts.list();
      query<HTMLElement>("#draft-banner").hidden = !drafts.length;
      query("#draft-banner-text").textContent = drafts.length > 1 ? `${drafts.length} 份未完成草稿` : "有未完成的草稿";
    } catch {
      query<HTMLElement>("#draft-banner").hidden = false;
      query("#draft-banner-text").textContent = "草稿无法读取，原数据仍保留";
    }
  }

  private savePreferences(): void {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ search: this.options.search, filter: this.options.filter, completedOpen: this.options.completedOpen, planTab: this.lastPlanTab, courseTermId: this.options.courseView.termId, tag: this.options.tag, pinnedOnly: this.options.pinnedOnly, notebookId: this.options.notebookId, sort: this.options.sort })); }
    catch { showToast("界面偏好未能保存，记录不受影响"); }
  }

  private async applyRoute(route: Route): Promise<void> {
    const keepTabFocus = this.state.view === "plan" && route.view === "plan" && document.activeElement?.closest(".segmented");
    this.organization.resetSelection();
    this.state.view = route.view;
    document.body.dataset.currentView = route.view;
    const courseDetail = route.view === "plan" && route.selection?.entity === "course";
    const detail = query<HTMLElement>("#entry-detail");
    (courseDetail ? query("#plan-course-detail") : query(".records-workspace")).append(detail);
    query("#view-plan").classList.toggle("has-course-detail", Boolean(courseDetail));
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
    hydrateImages();
    if (route.editing || route.newNoteId) {
      const id = route.newNoteId || route.selection!.id;
      const requested = this.requestedNotes.get(id); this.requestedNotes.delete(id);
      if (requested?.draft.id === id) this.editor.open(requested.draft, requested.recovered, true);
      else {
        const record = this.state.items.find(item => item.id === id && !item.deletedAt && item.kind === "note");
        if (record) await this.editor.openRecord(record, true);
        else if (route.newNoteId) {
          const draft = (await this.editor.drafts.list()).find(draft => draft.id === id);
          this.editor.open(draft || { key: "new", id, type: "note", title: "", body: "", date: "", time: "", updatedAt: new Date().toISOString() }, Boolean(draft), true);
        }
      }
    } else {
      const heading = route.selection ? query<HTMLElement>("#detail-title") : query<HTMLElement>(`[data-view-panel="${route.view}"] h1`);
      if (!keepTabFocus) heading.focus({ preventScroll: true });
    }
    try { localStorage.setItem("jinriji:view", route.view); } catch { /* Navigation remains usable without preferences. */ }
    this.savePreferences();
  }

  private openDetail(selection: Selection): void { this.navigation.go(selection.entity === "course" ? { view: "plan", tab: "courses", selection } : { view: "notes", selection }); }

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
      if (this.pending.has(id)) { checkbox.checked = !checkbox.checked; return; }
      this.pending.add(id);
      // Keep the keyboard's focus anchor while persistence runs.
      checkbox.disabled = document.body.dataset.motionInput !== "keyboard";
      checkbox.setAttribute("aria-disabled", "true");
      const feedback = taskFeedback(checkbox);
      void this.run(async () => {
        try {
          const current = this.state.items.find(item => item.id === id);
          if (!current) throw new Error("记录已变动，请刷新后重试");
          const completed = checkbox.checked;
          const updated = await this.repository.updateItem(id, { status: completed ? "completed" : "open" }, current.revision);
          await feedback.settled;
          await this.refresh();
          showToast(completed ? updated?.repeatNextId ? "已完成，已安排下一次" : "已完成" : "已恢复待办", completed && updated ? () => void this.run(async () => {
            await this.repository.updateItem(id, { status: "open" }, updated.revision); await this.refresh(); showToast("已撤销完成");
          }) : undefined);
        } catch (cause) { checkbox.checked = !checkbox.checked; throw cause; }
        finally { feedback.clear(); this.pending.delete(id); checkbox.disabled = false; checkbox.removeAttribute("aria-disabled"); }
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
      if (!this.editor.isOpen && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); void this.run(async () => this.editor.openNew("note"));
      }
      if (this.editor.isOpen || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]'))) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && /^Digit[1-4]$/.test(event.code)) {
        event.preventDefault(); const view = (["today", "notes", "plan", "settings"] as ViewName[])[Number(event.code.slice(-1)) - 1]!;
        this.navigation.go({ view, ...(view === "plan" ? { tab: this.lastPlanTab } : {}) }); return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); void this.navigation.go({ view: "notes" }).then(() => { search.focus(); search.select(); }); }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault(); const type = this.state.view === "plan" ? this.lastPlanTab === "courses" ? "course" : this.lastPlanTab === "tasks" ? "task" : "schedule" : "note";
        if (type === "course") this.study.openNewCourse();
        else void this.run(async () => this.editor.openNew(type, this.composeDate(type)));
      }
      if (event.key === "?") {
        event.preventDefault(); void this.navigation.go({ view: "settings" }).then(() => {
          query<HTMLDetailsElement>("#keyboard-shortcuts").open = true;
          query<HTMLElement>("#keyboard-shortcuts summary").focus();
        });
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
    if (event.target.closest("#entry-detail .detail-body") && !event.target.closest("a,button,input") && window.getSelection()?.isCollapsed) {
      const item = this.state.items.find(item => item.id === this.options.selection?.id && item.kind === "note" && !item.deletedAt);
      if (item) { await this.editor.openRecord(item, false, window.scrollY); return; }
    }
    const target = event.target.closest<HTMLElement>("button, a.brand, a[data-note-id]");
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    const data = target.dataset;
    if (data.noteId) { event.preventDefault(); this.openDetail({ entity: "item", id: data.noteId }); return; }
    if (data.view || data.viewJump || target.matches("a.brand")) {
      event.preventDefault();
      const view = (data.view || data.viewJump || "today") as ViewName;
      this.navigation.go({ view, ...(view === "plan" ? { tab: (data.jumpTab as PlanTab) || this.lastPlanTab } : {}) });
    }
    if (target.hasAttribute("data-open-compose")) {
      const type = data.composeType || (this.state.view === "plan" ? this.lastPlanTab === "courses" ? "course" : this.lastPlanTab === "week" ? "schedule" : "task" : "note");
      if (type === "course") { this.study.openNewCourse(); return; }
      await this.editor.openNew(type as "note" | "task" | "schedule" | "course", data.composeDate || this.composeDate(type));
    }
    if (data.courseNote) await this.editor.openNew("note", "", data.courseNote);
    if (target.id === "resume-draft") { const draft = (await this.editor.drafts.list())[0]; if (draft) this.editor.open(draft); }
    if (data.entryOpen) this.openDetail({ id: data.entryOpen, entity: data.entity === "course" ? "course" : "item" });
    if (target.hasAttribute("data-detail-back")) this.navigation.back();
    if (data.entryEdit) {
      const record = data.entity === "course" ? this.state.courses.find(course => course.id === data.entryEdit) : this.state.items.find(item => item.id === data.entryEdit);
      if (record) await this.editor.openRecord(record, false, this.options.selection?.id === record.id ? window.scrollY : undefined);
    }
    if (data.entryConvert) {
      if (this.pending.has(data.entryConvert)) return;
      const note = this.state.items.find(item => item.id === data.entryConvert);
      if (!note) return;
      this.pending.add(note.id); target.setAttribute("aria-busy", "true");
      try {
        const task = await this.repository.createLinkedTask(note.id, note.revision); await this.refresh();
        showToast("已创建待办，原文保留", () => this.openDetail({ entity: "item", id: task.id }), "查看待办");
      } finally { this.pending.delete(note.id); target.removeAttribute("aria-busy"); }
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

  private composeDate(type: string): string {
    if (type === "schedule") {
      if (this.state.view === "plan" && this.options.weekOffset) {
        const date = startOfWeek(new Date()); date.setDate(date.getDate() + this.options.weekOffset * 7); return dayKey(date);
      }
      return dayKey();
    }
    return this.state.view === "today" && type === "task" ? dayKey() : "";
  }
}
