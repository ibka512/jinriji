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

async function bootstrap(): Promise<void> {
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
  showToast("数据初始化失败，旧数据仍然保留");
});
