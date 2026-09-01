"""v0.5 acceptance. Every scenario uses an isolated browser context, never user storage."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

BASE_URL = os.getenv("JINRIJI_BASE_URL", "http://127.0.0.1:4173")
OUTPUT = Path(os.getenv("JINRIJI_TEST_OUTPUT", "test-results/screenshots-v0.10")).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
FIXED = datetime(2026, 8, 31, 4, 0, tzinfo=timezone.utc)
assert urlparse(BASE_URL).hostname in ("localhost", "127.0.0.1", "::1"), "Run this suite against a local build only"


def context_page(browser, width=1440, height=1000, **kwargs):
    context = browser.new_context(viewport={"width": width, "height": height}, timezone_id="Asia/Shanghai", **kwargs)
    page = context.new_page()
    page.clock.set_fixed_time(FIXED)
    page.set_default_timeout(8000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    ready(page)
    return context, page, errors


def ready(page):
    expect(page.locator("body")).to_have_attribute("data-app-ready", "true")


def nav(page, name):
    page.locator(f"[data-view='{name}']:visible").click()
    expect(page.locator(f"[data-view-panel='{name}']")).to_be_visible()


def begin_compose(page, kind="note"):
    if kind != "note":
        nav(page, "plan")
        tab = page.get_by_role("tab", name="课程表" if kind == "course" else "待办" if kind == "task" else "本周", exact=True)
        tab.click(); expect(tab).to_have_attribute("aria-selected", "true")
    if kind == "note":
        page.keyboard.press("Control+k")
    else:
        page.locator("#view-plan .page-header [data-open-compose]:visible, .mobile-quick-add:visible").click()
    expect(page.locator("#note-editor-page" if kind == "note" else "#study-dialog" if kind == "course" else "#compose-layer")).to_be_visible()
    if kind not in ("note", "course"):
        page.locator(f"[data-entry-type='{kind}']").click()


def compose(page, text, kind="note", title="", date="", time=""):
    if kind == "note":
        nav(page, "today")
    begin_compose(page, kind)
    if kind == "course":
        page.locator("#study-name").fill(title)
        page.locator("#study-term").select_option("")
        page.locator("#study-single-date").fill(date)
        page.locator("#study-single-time").fill(time)
        page.locator("#study-save").click()
        expect(page.locator("#study-dialog")).not_to_be_visible()
        page.wait_for_function("() => !history.state?.jinrijiModal")
        return
    page.locator("#entry-title").fill(title)
    if kind != "course":
        page.locator("#quick-entry:visible, .tiptap:visible").fill(text)
    if kind != "note":
        page.locator("#entry-date").fill(date)
        page.locator("#entry-time").fill(time)
    save(page)


def save(page):
    page.locator("#save-entry").click()
    expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator("#note-editor-page")).not_to_be_visible()
    page.wait_for_function("() => !history.state?.jinrijiModal")
    page.wait_for_function("() => !location.hash.endsWith('/edit') && !location.hash.startsWith('#notes/new/')")


def assert_width(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal document overflow"


def upload(page, payload):
    page.locator("#import-data").set_input_files({"name": "fixture.json", "mimeType": "application/json", "buffer": json.dumps(payload, ensure_ascii=False).encode()})


def test_records(browser):
    context, page, errors = context_page(browser)
    expect(page.locator("#today-date")).to_have_text("8月31日星期一")
    expect(page.locator("#today-content")).not_to_contain_text("设计史")
    compose(page, "正文第一行\n正文第二行", title="可编辑的便签")
    nav(page, "notes")
    expect(page.locator("#notes-list .note-card")).to_have_count(1)
    page.locator("#notes-list .record-open").click()
    expect(page.locator("#detail-title")).to_have_text("可编辑的便签")
    expect(page.locator(".detail-body")).to_have_text("正文第一行\n正文第二行", use_inner_text=True)
    item_url = page.url
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#quick-entry:visible, .tiptap:visible").fill("改好的正文\n保留换行")
    page.locator("#entry-title").fill("更新后的便签")
    save(page)
    expect(page.locator("#detail-title")).to_have_text("更新后的便签")
    assert page.url == item_url
    expect(page.locator("#notes-list .note-card")).to_have_count(1)
    page.locator("[data-detail-back]").click()
    page.get_by_role("searchbox", name="搜索记录").fill("改好的正文")
    expect(page.locator("#notes-list .note-card")).to_have_count(1)
    page.locator("#notes-list .record-open").click()
    page.go_back()
    expect(page.get_by_role("searchbox", name="搜索记录")).to_have_value("改好的正文")
    nav(page, "today"); nav(page, "notes")
    expect(page.get_by_role("searchbox", name="搜索记录")).to_have_value("改好的正文")
    page.locator("#notes-list .record-open").click()
    page.get_by_role("button", name="删除", exact=True).click()
    nav(page, "settings")
    expect(page.locator("#trash-list")).to_contain_text("更新后的便签")
    page.reload(); ready(page)
    page.locator("#trash-list [data-entry-restore]").click()
    expect(page.locator("#trash-list")).to_contain_text("没有已删除")
    nav(page, "notes")
    expect(page.locator("#notes-list .note-card")).to_have_count(1)
    page.screenshot(path=str(OUTPUT / "records-desktop.png"), full_page=True)
    assert not errors, errors
    context.close()


def test_drafts(browser):
    context, page, errors = context_page(browser, 390, 844)
    begin_compose(page, "task")
    page.locator("#quick-entry:visible, .tiptap:visible").fill("手机端未写完的草稿")
    expect(page.locator("#draft-status")).to_have_text("草稿已暂存")
    page.get_by_role("button", name="关闭编辑器").click()
    expect(page.locator("#draft-banner")).to_be_visible()
    page.reload(); ready(page)
    page.locator("#resume-draft").click()
    expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_have_value("手机端未写完的草稿")
    page.reload(); ready(page)
    page.locator("#resume-draft").click()
    expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_have_value("手机端未写完的草稿")
    page.go_back()
    expect(page.locator("#compose-layer")).not_to_be_visible()
    page.locator("#resume-draft").click()
    save(page)
    expect(page.locator("#draft-banner")).not_to_be_visible()
    nav(page, "notes")
    expect(page.locator("#notes-list .note-card")).to_have_count(1)
    page.locator("#notes-list .record-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#quick-entry:visible, .tiptap:visible").fill("不想保存的修改")
    page.locator("#discard-draft").click()
    page.locator("#confirm-cancel").click()
    expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_have_value("不想保存的修改")
    page.locator("#discard-draft").click()
    page.locator("#confirm-accept").click()
    expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator("#detail-title")).to_have_text("手机端未写完的草稿")
    assert not errors, errors
    context.close()


def test_tasks_courses(browser):
    context, page, errors = context_page(browser, 390, 844)
    compose(page, "今日任务", "task", date="2026-08-31")
    compose(page, "昨日任务", "task", date="2026-08-30")
    compose(page, "未来任务", "task", date="2026-09-03", time="09:00")
    compose(page, "无日期任务", "task")
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    expect(page.locator("#task-count")).to_have_text("4")
    for group, text in [("today", "今日任务"), ("overdue", "昨日任务"), ("later", "未来任务"), ("undated", "无日期任务")]:
        expect(page.locator(f"[data-task-group='{group}']")).to_contain_text(text)
    page.locator("[data-task-group='today'] input").check()
    expect(page.locator("#task-count")).to_have_text("3")
    expect(page.locator(".completed-group")).not_to_have_attribute("open", "")
    nav(page, "today")
    expect(page.get_by_label("今日待办完成数")).to_have_text("1 / 1")
    page.reload(); ready(page)
    expect(page.get_by_label("今日待办完成数")).to_have_text("1 / 1")
    nav(page, "plan")
    expect(page.get_by_role("tab", name="待办", exact=True)).to_have_attribute("aria-selected", "true")
    page.locator(".completed-group summary").click()
    page.locator(".completed-group input").uncheck()
    expect(page.locator("[data-task-group='today']")).to_contain_text("今日任务")
    compose(page, "", "course", title="日语课", date="2026-09-01", time="10:00")
    page.get_by_role("tab", name="课程表").click()
    page.locator("#user-course-list .record-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#entry-title").fill("日语会话")
    page.locator("#entry-time").fill("11:00")
    save(page)
    expect(page.locator("#detail-title")).to_have_text("日语会话")
    expect(page.locator("#entry-detail")).to_contain_text("11:00")
    page.get_by_role("button", name="删除", exact=True).click()
    nav(page, "settings"); page.locator("#trash-list [data-entry-restore]").click()
    nav(page, "plan"); page.get_by_role("tab", name="本周", exact=True).click()
    expect(page.locator("#week-agenda")).to_contain_text("日语会话")
    page.get_by_role("button", name="下一周", exact=True).click()
    expect(page.locator("#week-agenda")).not_to_contain_text("日语会话")
    # Cross midnight: yesterday's today group becomes overdue, without a reload.
    page.clock.set_fixed_time(datetime(2026, 8, 31, 16, 1, tzinfo=timezone.utc))
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    nav(page, "today")
    expect(page.locator("#today-date")).to_have_text("9月1日星期二")
    expect(page.get_by_label("今日待办完成数")).to_have_text("0 / 0")
    assert not errors, errors
    context.close()


def test_backup(browser):
    context, page, errors = context_page(browser)
    compose(page, "不能被取消导入覆盖的原记录")
    nav(page, "settings")
    empty = {"version": 2, "exportedAt": "2026-08-31T04:00:00Z", "theme": "sakura", "glass": False, "items": [], "courses": []}
    upload(page, empty)
    expect(page.locator("#confirm-dialog")).to_be_visible()
    expect(page.locator("#confirm-message")).to_contain_text("0 条记录")
    page.locator("#confirm-cancel").click()
    nav(page, "notes"); expect(page.locator("#notes-list .note-card")).to_have_count(1)
    nav(page, "settings"); upload(page, empty); page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    expect(page.locator("#restore-recovery")).to_be_visible()
    nav(page, "notes"); expect(page.locator("#notes-list .note-card")).to_have_count(0)
    nav(page, "settings"); page.locator("#restore-recovery").click(); page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    nav(page, "notes"); expect(page.locator("#notes-list .note-card")).to_have_count(1)
    nav(page, "settings"); upload(page, {**empty, "items": [{"id": "malformed"}]})
    expect(page.locator("#toast-message")).to_contain_text("无效")
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    with page.expect_download() as download_info:
        page.locator("#export-data").click()
    download = download_info.value
    payload = json.loads(Path(download.path()).read_text())
    assert payload["version"] == 6 and len(payload["items"]) == 1 and payload["glass"] is True
    expect(page.locator("#last-export")).to_contain_text("上次导出")
    assert not errors, errors
    context.close()


def test_layouts(browser):
    for width, height, mode, scale in [(320, 568, "light", 100), (390, 844, "dark", 100), (768, 1024, "light", 100), (1440, 1000, "dark", 100), (667, 375, "dark", 100), (390, 844, "dark", 200)]:
        context, page, errors = context_page(browser, width, height, color_scheme=mode, reduced_motion="reduce")
        page.evaluate("size => document.documentElement.style.fontSize = size + '%'", scale)
        compose(page, "这是供验收的长内容。\n" * 16, title="一段很长的记录：在手机和平板上继续阅读与编辑")
        compose(page, "完成今天的一件小事", "task", date="2026-08-31")
        nav(page, "today"); assert_width(page)
        page.screenshot(path=str(OUTPUT / f"today-{width}-{mode}-{scale}.png"), full_page=True)
        if width <= 700:
            box = page.locator(".mobile-quick-add").bounding_box()
            assert abs(box["width"] - box["height"]) < 1 and box["width"] >= 44
            radius = page.locator(".mobile-nav").evaluate("el => parseFloat(getComputedStyle(el).borderRadius)")
            assert radius >= page.locator(".mobile-nav").bounding_box()["height"] / 2
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_function("() => Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) < 2")
            card = page.locator("#today-content .note-preview").bounding_box()
            dock = page.locator(".mobile-tab-area").bounding_box()
            assert card["y"] + card["height"] <= dock["y"] - 8, "last card must clear the dock"
        nav(page, "notes")
        page.locator("#record-filters summary").click()
        page.locator("#record-filter").select_option("note")
        page.locator("#record-filters summary").click()
        page.locator("#notes-list .record-open").click()
        assert_width(page)
        if width >= 1100:
            assert page.locator("#notes-list").bounding_box()["x"] < page.locator("#entry-detail").bounding_box()["x"]
        page.screenshot(path=str(OUTPUT / f"detail-{width}-{mode}-{scale}.png"), full_page=True)
        page.get_by_role("button", name="编辑", exact=True).click()
        expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_be_focused()
        assert_width(page)
        save_box = page.locator("#save-entry").bounding_box()
        assert save_box and save_box["y"] >= 0 and save_box["y"] + save_box["height"] <= height + 1
        page.screenshot(path=str(OUTPUT / f"editor-{width}-{mode}-{scale}.png"), full_page=False)
        page.keyboard.press("Escape")
        expect(page.locator("#compose-layer")).not_to_be_visible()
        nav(page, "settings"); assert_width(page)
        nav(page, "plan"); assert_width(page)
        assert not errors, errors
        context.close()


def test_offline(browser):
    context, page, errors = context_page(browser)
    compose(page, "离线仍能编辑")
    page.wait_for_function("() => navigator.serviceWorker.controller")
    cache_names = page.evaluate("async () => (await caches.keys()).filter(name => name.startsWith('jinriji-'))")
    assert len(cache_names) == 1, "Expected one active application cache"
    cached = page.evaluate("async name => (await (await caches.open(name)).keys()).map(request => request.url)", cache_names[0])
    assert any('/assets/' in url and url.endswith('.js') for url in cached)
    assert any('/assets/' in url and url.endswith('.css') for url in cached)
    # Cached production assets, not the live developer HMR connection.
    context.set_offline(True)
    page.reload(); ready(page)
    nav(page, "notes"); page.locator("#notes-list .record-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#quick-entry:visible, .tiptap:visible").fill("离线更新成功"); save(page)
    expect(page.locator("#detail-title")).to_have_text("离线更新成功")
    assert not errors, errors
    context.close()


def test_failures_and_keyboard(browser):
    context, page, errors = context_page(browser, 390, 844)
    begin_compose(page, "task")
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("请输入")
    expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_be_focused()
    page.locator("#quick-entry:visible, .tiptap:visible").fill("失败后仍保留输入")
    page.locator("[data-entry-type='task']").click()
    page.locator("#entry-time").fill("10:00")
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("先选择日期")
    page.locator("#entry-date").fill("2026-08-31")
    # A disposable context simulates one failed IndexedDB write, then permits retry.
    page.evaluate("""() => {
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(...args) {
        if (this.name === 'items') {
          IDBObjectStore.prototype.add = original;
          throw new DOMException('Test quota', 'QuotaExceededError');
        }
        return original.apply(this, args);
      };
    }""")
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("存储空间不足")
    expect(page.locator("#quick-entry:visible, .tiptap:visible")).to_have_value("失败后仍保留输入")
    expect(page.locator("#save-entry")).to_be_enabled()
    page.keyboard.press("Control+Enter")
    expect(page.locator("#compose-layer")).not_to_be_visible()
    nav(page, "notes"); expect(page.locator("#notes-list .note-card")).to_have_count(1)
    nav(page, "plan"); page.get_by_role("tab", name="本周", exact=True).focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("tab", name="待办", exact=True)).to_be_focused()
    expect(page.get_by_role("tab", name="待办", exact=True)).to_have_attribute("aria-selected", "true")
    nav(page, "settings"); page.get_by_role("radio", name="苔庭").focus(); page.keyboard.press("ArrowRight")
    expect(page.get_by_role("radio", name="樱雨")).to_be_checked()
    assert not errors, errors
    context.close()


def test_legacy(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.add_init_script("localStorage.setItem('jinriji:entries', JSON.stringify([{id:'legacy-note',text:'保留旧便签',type:'note'},{id:'legacy-course',text:'保留旧课程',type:'course'}]))")
    page.goto(BASE_URL); ready(page); nav(page, "notes")
    expect(page.locator("#notes-list")).to_contain_text("保留旧便签")
    assert page.evaluate("localStorage.getItem('jinriji:migration-backup:v1')") is not None
    nav(page, "plan"); page.get_by_role("tab", name="课程表").click()
    expect(page.locator("#user-course-list")).to_contain_text("保留旧课程")
    context.close()


def test_scroll_and_conflict(browser):
    context, page, errors = context_page(browser, 390, 844)
    stamp = "2026-08-31T04:00:00.000Z"
    items = [{"id": f"note-{index}", "kind": "note", "title": f"列表记录 {index}", "body": f"第 {index} 条正文", "status": "open", "allDay": False, "reminderOffsets": [], "createdAt": stamp, "updatedAt": stamp, "revision": 1} for index in range(24)]
    nav(page, "settings")
    upload(page, {"version": 2, "exportedAt": stamp, "theme": "sage", "glass": True, "items": items, "courses": []})
    page.locator("#confirm-accept").click(); expect(page.locator("#confirm-dialog")).not_to_be_visible()
    nav(page, "notes")
    page.get_by_role("searchbox", name="搜索记录").fill("正文")
    last = page.locator("#notes-list .record-open").last
    last.scroll_into_view_if_needed()
    before = page.evaluate("scrollY")
    assert before > 1000
    last.click(); expect(page.locator("#entry-detail")).to_be_visible()
    page.go_back()
    page.wait_for_function("expected => Math.abs(scrollY - expected) < 2", arg=before)
    expect(page.get_by_role("searchbox", name="搜索记录")).to_have_value("正文")
    page.locator("#notes-list .record-open").last.click()
    detail_url = page.url
    page.get_by_role("button", name="编辑", exact=True).click()
    # Keep the first window in an IME composition, so only the second window commits.
    page.locator(".tiptap").dispatch_event("compositionstart")
    page.locator("#quick-entry:visible, .tiptap:visible").fill("第一页的草稿")
    other = context.new_page(); other.goto(detail_url); ready(other)
    other.bring_to_front()
    other.get_by_role("button", name="编辑", exact=True).click()
    # A user selects the current text before replacing it. Playwright fill on a
    # just-focused background contenteditable can race the browser's selection.
    other.locator(".tiptap").click()
    other.locator(".tiptap").press("Meta+a" if sys.platform == "darwin" else "Control+a")
    other.keyboard.insert_text("第二页已经保存的正文")
    expect(other.locator(".tiptap")).to_have_text("第二页已经保存的正文")
    save(other)
    page.bring_to_front()
    page.locator(".tiptap").dispatch_event("compositionend")
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("另一窗口")
    expect(page.locator(".tiptap")).to_have_text("第一页的草稿")
    page.locator("#save-as-new").click(); expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator("#note-editor-page")).not_to_be_visible()
    other.reload(); ready(other)
    expect(other.locator(".detail-body")).to_have_text("第二页已经保存的正文")
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for test in [test_records, test_drafts, test_tasks_courses, test_backup, test_layouts, test_offline, test_failures_and_keyboard, test_legacy, test_scroll_and_conflict]:
            test(browser)
            print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("Core UI regression passed: records, drafts, tasks/courses, backup, responsive, offline and legacy migration")
