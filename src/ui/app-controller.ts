import type { Course, Item } from "../domain/models";
import { createBackup, parseBackup } from "../data/backup";
import { combineLocalDateTime } from "../data/legacy-conversion";
import { AppRepository, SettingsRepository } from "../data/repositories";
import { renderEntries } from "../features/entries/render";
import { query, queryAll } from "./dom";
import { showToast } from "./toast";
import { applyTheme, isThemeName, type ThemeName } from "./theme";

type ViewName = "today" | "notes" | "plan" | "settings";
type ComposeType = "note" | "task" | "schedule" | "course";

interface AppState {
  view: ViewName;
  theme: ThemeName;
  glass: boolean;
  items: Item[];
  courses: Course[];
}

export class AppController {
  private readonly composeLayer = query<HTMLElement>("#compose-layer");
  private readonly quickEntry = query<HTMLTextAreaElement>("#quick-entry");
  private composeTrigger: HTMLElement | null = null;
  private composeCloseTimer: number | undefined;
  private saveInProgress = false;

  constructor(
    private readonly repository: AppRepository,
    private readonly settings: SettingsRepository,
    private readonly state: AppState,
  ) {}

  initialize(): void {
    renderEntries(this.state.items, this.state.courses);
    applyTheme(this.state.theme);
    query<HTMLInputElement>("#glass-toggle").checked = this.state.glass;
    document.body.classList.toggle("no-glass", !this.state.glass);
    this.setView(this.state.view);
    this.bindEvents();
  }

  private async refresh(): Promise<void> {
    [this.state.items, this.state.courses] = await Promise.all([
      this.repository.listItems(),
      this.repository.listCourses(),
    ]);
    renderEntries(this.state.items, this.state.courses);
  }

  private setView(name: ViewName, focusHeading = false): void {
    const target = query<HTMLElement>(`[data-view-panel="${name}"]`);
    queryAll<HTMLElement>("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel === target));
    queryAll<HTMLButtonElement>("[data-view]").forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    this.state.view = name;
    localStorage.setItem("jinriji:view", name);
    if (focusHeading) {
      window.scrollTo({ top: 0, behavior: "auto" });
      target.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
  }

  private selectEntryType(type: ComposeType): void {
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach((button) => {
      const active = button.dataset.entryType === type;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    query<HTMLElement>("#entry-details").hidden = !["task", "schedule", "course"].includes(type);
    query<HTMLElement>("#compose-title").textContent = type === "course" ? "添加哪一门课程？" : type === "task" ? "接下来要做什么？" : type === "schedule" ? "把什么安排进时间？" : "此刻想到什么？";
  }

  private openCompose(type: ComposeType, trigger?: HTMLElement): void {
    window.clearTimeout(this.composeCloseTimer);
    this.composeLayer.classList.remove("is-closing");
    this.selectEntryType(type);
    this.composeTrigger = trigger ?? (
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null
    );
    this.composeLayer.classList.add("is-open");
    this.composeLayer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => this.quickEntry.focus(), 180);
  }

  private closeCompose(): void {
    if (!this.composeLayer.classList.contains("is-open")) return;
    this.composeLayer.classList.add("is-closing");
    this.composeLayer.classList.remove("is-open");
    this.composeLayer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    this.composeCloseTimer = window.setTimeout(() => this.composeLayer.classList.remove("is-closing"), 320);
    this.composeTrigger?.focus({ preventScroll: true });
    this.composeTrigger = null;
  }

  private keepFocusInCompose(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !this.composeLayer.classList.contains("is-open")) return;
    const focusable = queryAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), input:not([disabled])",
      this.composeLayer,
    ).filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (!(document.activeElement instanceof Node) || !this.composeLayer.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private async saveEntry(): Promise<void> {
    if (this.saveInProgress) return;
    const text = this.quickEntry.value.trim();
    if (!text) {
      this.quickEntry.focus();
      showToast("先写下一点什么吧");
      return;
    }
    const saveButton = query<HTMLButtonElement>("#save-entry");
    const type = query<HTMLButtonElement>("[data-entry-type].is-active").dataset.entryType as ComposeType;
    const date = query<HTMLInputElement>("#entry-date").value;
    const time = query<HTMLInputElement>("#entry-time").value;
    const scheduledAt = combineLocalDateTime(date, time);

    this.saveInProgress = true;
    saveButton.disabled = true;
    saveButton.setAttribute("aria-busy", "true");
    saveButton.textContent = "保存中…";
    try {
      if (type === "course") {
        await this.repository.createCourse({ name: text, firstMeetingAt: scheduledAt });
      } else {
        const kind = type === "task" ? "task" : type === "schedule" ? "event" : "note";
        await this.repository.createItem({
          title: text,
          kind,
          dueAt: kind === "task" ? scheduledAt : undefined,
          startAt: kind === "event" ? scheduledAt : undefined,
          allDay: Boolean(date && !time),
        });
      }

      await this.refresh();
      this.quickEntry.value = "";
      query<HTMLInputElement>("#entry-date").value = "";
      query<HTMLInputElement>("#entry-time").value = "";
      this.closeCompose();
      showToast(type === "task" ? "已经加入今日待办" : type === "course" ? "课程已经添加" : "已经收进今日记");
    } catch (error) {
      console.error("记录保存失败", error);
      showToast("保存失败，请稍后再试");
    } finally {
      this.saveInProgress = false;
      saveButton.disabled = false;
      saveButton.removeAttribute("aria-busy");
      saveButton.textContent = "保存记录";
    }
  }

  private setPlanTab(name: string): void {
    queryAll<HTMLButtonElement>("[data-plan-tab]").forEach((button) => {
      const active = button.dataset.planTab === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    queryAll<HTMLElement>("[data-plan-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.planPanel === name));
  }

  private exportData(): void {
    const payload = JSON.stringify(createBackup(this.state.items, this.state.courses, this.state.theme, this.state.glass), null, 2);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    link.href = url;
    link.download = `今日记-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("数据已经导出");
  }

  private async importData(file?: File): Promise<void> {
    if (!file) return;
    try {
      const payload = parseBackup(await file.text());
      await this.repository.replaceData(payload.items, payload.courses);
      const theme = isThemeName(payload.theme) ? payload.theme : "sage";
      await Promise.all([this.settings.set("theme", theme), this.settings.set("glass", payload.glass)]);
      this.state.theme = theme;
      this.state.glass = payload.glass;
      applyTheme(theme);
      document.body.classList.toggle("no-glass", !payload.glass);
      query<HTMLInputElement>("#glass-toggle").checked = payload.glass;
      await this.refresh();
      showToast("数据已经恢复");
    } catch (error) {
      console.error(error);
      showToast("无法读取这个备份文件");
    }
  }

  private bindEvents(): void {
    queryAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => this.setView(button.dataset.view as ViewName, true)));
    queryAll<HTMLButtonElement>("[data-view-jump]").forEach((button) => button.addEventListener("click", () => this.setView(button.dataset.viewJump as ViewName, true)));
    queryAll<HTMLButtonElement>("[data-open-compose]").forEach((button) => button.addEventListener("click", () => this.openCompose((button.dataset.composeType || "note") as ComposeType, button)));
    queryAll<HTMLButtonElement>("[data-close-compose]").forEach((button) => button.addEventListener("click", () => this.closeCompose()));
    query<HTMLButtonElement>("#save-entry").addEventListener("click", () => void this.saveEntry());
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach((button) => button.addEventListener("click", () => this.selectEntryType(button.dataset.entryType as ComposeType)));
    queryAll<HTMLButtonElement>(".check-button").forEach((button) => button.addEventListener("click", () => {
      const done = button.classList.toggle("is-done");
      button.setAttribute("aria-pressed", String(done));
      showToast(done ? "完成了一件事" : "已恢复待办");
    }));
    queryAll<HTMLButtonElement>(".theme-dot").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.theme;
      if (!name || !isThemeName(name)) return;
      this.state.theme = name;
      applyTheme(name);
      void this.settings.set("theme", name);
    }));
    query<HTMLInputElement>("#glass-toggle").addEventListener("change", (event) => {
      this.state.glass = (event.currentTarget as HTMLInputElement).checked;
      document.body.classList.toggle("no-glass", !this.state.glass);
      void this.settings.set("glass", this.state.glass);
      showToast(this.state.glass ? "液态玻璃已经开启" : "已切换为实色表面");
    });
    queryAll<HTMLButtonElement>("[data-plan-tab]").forEach((button) => button.addEventListener("click", () => this.setPlanTab(button.dataset.planTab || "week")));
    query<HTMLButtonElement>("#export-data").addEventListener("click", () => this.exportData());
    query<HTMLInputElement>("#import-data").addEventListener("change", (event) => void this.importData((event.currentTarget as HTMLInputElement).files?.[0]));

    document.addEventListener("click", (event) => void this.handleDocumentClick(event));
    document.addEventListener("change", (event) => void this.handleDocumentChange(event));
    document.addEventListener("keydown", (event) => {
      this.keepFocusInCompose(event);
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && this.composeLayer.classList.contains("is-open")) void this.saveEntry();
      if (event.key === "Escape" && this.composeLayer.classList.contains("is-open")) this.closeCompose();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.openCompose("note");
      }
    });
  }

  private async handleDocumentClick(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return;
    const convert = event.target.closest<HTMLElement>("[data-entry-convert]");
    const remove = event.target.closest<HTMLElement>("[data-entry-delete]");
    if (convert?.dataset.entryConvert) {
      await this.repository.updateItem(convert.dataset.entryConvert, { kind: "task" });
      await this.refresh();
      this.setView("plan", true);
      this.setPlanTab("tasks");
      showToast("已经转为待办");
    }
    if (remove?.dataset.entryDelete) {
      const id = remove.dataset.entryDelete;
      const deleted = await this.repository.softDeleteItem(id);
      if (!deleted) return;
      await this.refresh();
      showToast("记录已删除", () => void this.repository.restoreItem(id).then(() => this.refresh()).then(() => showToast("记录已经恢复")));
    }
  }

  private async handleDocumentChange(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    const id = event.target.dataset.entryCheck;
    if (!id) return;
    await this.repository.updateItem(id, { status: event.target.checked ? "completed" : "open" });
    await this.refresh();
    showToast(event.target.checked ? "完成了一件事" : "已恢复待办");
  }
}
