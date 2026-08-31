import { createFullBackup, MAX_BACKUP_BYTES, parseBackup } from "../../data/backup";
import { AppRepository, RECOVERY_KEY, SettingsRepository, type RecoveryPoint } from "../../data/repositories";
import { momentLabel } from "../../domain/dates";
import { confirmAction } from "../../ui/confirmation";
import { query } from "../../ui/dom";
import { showToast } from "../../ui/toast";
import { isThemeName } from "../../ui/theme";

export class BackupController {
  private busy = false;
  constructor(private readonly repository: AppRepository, private readonly settings: SettingsRepository, private readonly refresh: () => Promise<void>) {}

  initialize(): void {
    query("#export-data").addEventListener("click", () => void this.run(() => this.export()));
    query<HTMLInputElement>("#import-data").addEventListener("change", event => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0]; input.value = "";
      if (file) void this.run(() => this.import(file));
    });
    query("#restore-recovery").addEventListener("click", () => void this.run(() => this.restore()));
  }

  async renderStatus(): Promise<void> {
    const [lastExport, recovery] = await Promise.all([
      this.settings.get<string | undefined>("lastExportAt", undefined),
      this.settings.get<RecoveryPoint | undefined>(RECOVERY_KEY, undefined),
    ]);
    query("#last-export").textContent = lastExport ? `上次导出 ${momentLabel(lastExport)}` : "尚未导出";
    query<HTMLElement>("#restore-recovery").hidden = !recovery;
    query("#recovery-time").textContent = recovery ? momentLabel(recovery.savedAt) : "";
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await action(); }
    catch (cause) { showToast(cause instanceof SyntaxError ? "备份不是有效的 JSON 文件，未导入" : cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { this.busy = false; }
  }

  private async export(): Promise<void> {
    const data = await this.repository.allRecords();
    const theme = await this.settings.get("theme", "sage");
    const payload = createFullBackup(data.items, data.courses, theme, data);
    const serialized = JSON.stringify(payload);
    const blob = new Blob([serialized], { type: "application/json" });
    if (blob.size > MAX_BACKUP_BYTES) throw new Error("完整备份已超过 64 MB，未生成不可恢复的备份。请先分篇导出正文并减少图片。");
    parseBackup(serialized); // Never emit a backup our importer cannot restore.
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url;
    link.download = `今日记-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    await this.settings.set("lastExportAt", new Date().toISOString());
    await this.renderStatus();
    showToast("已生成备份，请保存下载文件");
  }

  private async import(file: File): Promise<void> {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("备份不能超过 64 MB");
    const payload = parseBackup(await file.text());
    if (!isThemeName(payload.theme)) payload.theme = "sage";
    const current = await this.repository.allRecords();
    const count = payload.items.filter(item => !item.deletedAt).length;
    const courses = payload.courses.filter(course => !course.deletedAt).length;
    const deleted = payload.items.length + payload.courses.length - count - courses;
    const libraryInfo = payload.version === 6 ? `含 ${payload.notebooks.filter(book => !book.deletedAt).length} 个笔记本、${payload.assets.length} 张图片。` : "旧备份不含笔记本，当前笔记本将被替换为空。";
    const scheduleInfo = (payload.version !== 2 ? `另含 ${payload.terms.length} 个学期、${payload.recurrenceRules.filter(rule => !rule.deletedAt).length} 条排课规则、${payload.occurrenceExceptions.length} 次调整。`
      : "此旧版备份不含学期和排课规则，导入会替换当前排课数据。") + libraryInfo;
    const confirmed = await confirmAction("导入备份", `备份时间：${momentLabel(payload.exportedAt)}\n包含 ${count} 条记录、${courses} 门课程、${deleted} 条最近删除。\n${scheduleInfo}\n将替换当前 ${current.items.length} 条记录与 ${current.courses.length} 门课程（含最近删除、学期与排课）。导入前会保留一个完整恢复点，草稿不受影响。`, "确认导入", () => this.repository.importBackup(payload));
    if (confirmed) { await this.refresh(); showToast("已导入，可在设置中恢复导入前的数据"); }
  }

  private async restore(): Promise<void> {
    const recovery = await this.settings.get<RecoveryPoint | undefined>(RECOVERY_KEY, undefined);
    if (!recovery) throw new Error("没有可用的恢复点");
    const confirmed = await confirmAction("恢复数据？", `恢复到 ${momentLabel(recovery.savedAt)} 保存的记录、课程及排课数据。${recovery.payload.version === 2 ? "该旧恢复点不含排课数据。" : ""}当前数据会成为新的恢复点，草稿不受影响。`, "恢复", async () => {
      if (!await this.repository.restoreRecovery()) throw new Error("恢复点已不存在");
    });
    if (confirmed) { await this.refresh(); showToast("已恢复，操作前的数据已另存为恢复点"); }
  }
}
