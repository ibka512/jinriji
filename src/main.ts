import "../styles.css";
import "./features/entries/experience.css";
import "./features/courses/courses.css";
import "./features/entries/organization.css";
import "./features/entries/writing.css";
import "./features/entries/library.css";
import { IndexedDraftStore } from "./data/indexed-drafts";
import { WritingRepository } from "./data/writing-repository";
import { LibraryRepository } from "./data/library-repository";
import { initializeOfflineStatus } from "./platform/offline-status";
import { TimetableRepository } from "./data/timetable-repository";
import { db } from "./data/database";
import { migrateLocalStorage } from "./data/migrate-local-storage";
import { AppRepository, SettingsRepository } from "./data/repositories";
import { registerServiceWorker } from "./platform/service-worker";
import { AppController } from "./ui/app-controller";
import { showToast } from "./ui/toast";
import { isThemeName } from "./ui/theme";
import { version } from "../package.json";
import { initializeDisclosures } from "./ui/disclosures";
import "./ui/refinements.css";
import "./ui/motion.css";
import { initializeMotion } from "./ui/motion";

async function bootstrap(): Promise<void> {
  initializeMotion();
  document.querySelector("#app-version")!.textContent = `今日记 ${version} · 本地优先`;
  const migration = await migrateLocalStorage(db, localStorage);
  const repository = new AppRepository(db);
  const drafts = new IndexedDraftStore(db);
  try { await drafts.migrate(localStorage); }
  catch { showToast("旧草稿迁移未完成，原数据仍保留，请先备份浏览器数据。"); }
  const settings = new SettingsRepository(db);
  const [records, storedTheme] = await Promise.all([
    repository.allRecords(),
    settings.get("theme", localStorage.getItem("jinriji:theme") || "sage"),
  ]);
  const rawTheme = String(storedTheme);
  const theme = isThemeName(rawTheme) ? rawTheme : "sage";
  const view = localStorage.getItem("jinriji:view");
  const controller = new AppController(repository, settings, {
    view: view === "notes" || view === "plan" || view === "settings" ? view : "today",
    theme,
    items: records.items,
    courses: records.courses,
    timetable: records,
    library: records,
  }, new TimetableRepository(db), drafts, new WritingRepository(db), new LibraryRepository(db));
  controller.initialize();
  initializeDisclosures();
  initializeOfflineStatus();
  document.body.dataset.appReady = "true";
  registerServiceWorker(() => controller.prepareForUpdate());

  if (migration.migrated && migration.sourceCount > 0) {
    showToast(`已安全迁移 ${migration.sourceCount} 条旧记录`);
  }
}

void bootstrap().catch((error: unknown) => {
  console.error("今日记启动失败", error);
  document.body.dataset.appReady = "error";
  document.querySelector(".main-content")!.innerHTML = '<section class="startup-error paper-card" role="alert"><h1 tabindex="-1">暂时无法打开记录</h1><p>本次没有清除数据。请关闭其他今日记页面后重试，并确认浏览器允许本地存储。</p><button class="primary-button" id="retry-startup">重新加载</button><details><summary>仍然打不开？</summary><p>不要清除站点数据或卸载应用，以免丢失本机记录。若有已导出的备份，可在其他浏览器打开今日记并导入。</p></details></section>';
  document.querySelector("#retry-startup")!.addEventListener("click", () => location.reload());
  document.querySelector<HTMLElement>(".startup-error h1")?.focus();
  document.querySelectorAll<HTMLElement>(".sidebar,.mobile-tab-area").forEach(element => { element.inert = true; });
});
