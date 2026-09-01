"""v0.7 organization, navigation and repeat tasks. Local build, isolated user data."""
import json
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import BASE_URL, OUTPUT, context_page, ready, nav, compose, save, upload, assert_width, begin_compose
from timetable_acceptance import export_data, settle


def new_tagged(page, title, tags, repeat="", date=""):
    if not repeat:
        nav(page, "today")
    begin_compose(page, "task" if repeat else "note")
    page.locator("#entry-title").fill(title)
    page.locator("#quick-entry:visible, .tiptap:visible").fill("保留原文与分类")
    page.locator("#entry-organization summary").click()
    page.locator("#entry-tags").fill(tags)
    if repeat:
        page.locator("[data-entry-type='task']").click()
        page.locator("#entry-repeat").select_option(repeat)
        page.locator("#entry-date").fill(date)
    save(page)


def test_navigation(browser):
    for width, height, color, scale in [(1440, 1000, "light", 100), (1440, 1000, "dark", 100), (1024, 768, "light", 100), (768, 1024, "light", 200), (390, 844, "light", 100), (390, 844, "dark", 100), (320, 568, "light", 100), (667, 375, "dark", 100)]:
        context, page, errors = context_page(browser, width, height, color_scheme=color, reduced_motion="reduce" if scale == 200 else "no-preference")
        if scale != 100:
            page.add_style_tag(content=f"html {{ font-size: {scale}% !important; }}")
        expect(page.locator(".brand__seal")).to_have_count(0)
        if width > 700:
            expect(page.locator(".brand__text strong")).to_be_visible()
        for view in ["today", "notes", "plan", "settings"]:
            nav(page, view)
            for button in page.locator("[data-view]").all():
                active = button.get_attribute("data-view") == view
                assert button.get_attribute("aria-current") == ("page" if active else None)
                solid = button.locator(".icon-solid").evaluate("node => getComputedStyle(node).display")
                outline = button.locator(".icon-outline").evaluate("node => getComputedStyle(node).display")
                assert (solid != "none") == active and (outline != "none") != active
            assert_width(page)
        nav(page, "today")
        settle(page)
        page.screenshot(path=str(OUTPUT / f"navigation-{width}-{color}-{scale}.png"), full_page=False)
        assert not errors, errors
        context.close()


def test_tags_pins_and_bulk(browser):
    context, page, errors = context_page(browser, 390, 844, color_scheme="dark")
    new_tagged(page, "课堂笔记", "学习，学习,读书")
    new_tagged(page, "周末安排", "生活")
    nav(page, "notes")
    page.get_by_role("button", name="置顶：课堂笔记", exact=True).click()
    expect(page.locator("#notes-list .record-open").first).to_contain_text("课堂笔记")
    page.locator("#record-filters summary").click()
    page.locator("#pinned-only").click()
    expect(page.locator("#notes-list .record-open")).to_have_count(1)
    page.locator("#pinned-only").click()
    page.locator("#record-tag-filter").select_option("学习")
    expect(page.locator("#notes-list .record-open")).to_have_count(1)
    page.locator("#record-tag-filter").select_option("")
    page.locator("#record-filters summary").click()
    page.get_by_role("searchbox").fill("生活")
    expect(page.locator("#notes-list .record-open")).to_contain_text("周末安排")
    page.get_by_role("searchbox").fill("")
    page.locator("#organize-toggle").click(); page.locator("#select-visible").click()
    expect(page.locator("#selection-count")).to_have_text("已选 2 项")
    page.locator("[data-bulk-action='tag']").click()
    page.locator("#bulk-tags").fill("本学期")
    page.locator("[data-bulk-action='tag']").click()
    expect(page.locator("#bulk-toolbar")).not_to_be_visible()
    expect(page.locator("#notes-list .record-tags").filter(has_text="本学期")).to_have_count(2)
    page.locator("#organize-toggle").click(); page.locator("#select-visible").click()
    settle(page); assert_width(page)
    page.screenshot(path=str(OUTPUT / "organization-mobile-dark.png"), full_page=False)
    # Changing filters clears selection, so hidden records never remain selected.
    page.get_by_role("searchbox").fill("课堂")
    expect(page.locator("#bulk-toolbar")).not_to_be_visible()
    page.locator("#organize-toggle").click(); page.locator("#select-visible").click()
    expect(page.locator("#selection-count")).to_have_text("已选 1 项")
    page.locator("[data-bulk-action='delete']").click()
    page.locator("#confirm-cancel").click()
    expect(page.locator("#notes-list .record-open")).to_have_count(1)
    page.locator("[data-bulk-action='delete']").click(); page.locator("#confirm-accept").click()
    expect(page.locator("#notes-list .record-open")).to_have_count(0)
    nav(page, "settings"); expect(page.locator("#trash-list")).to_contain_text("课堂笔记")
    page.locator("#trash-list [data-entry-restore]").click()
    nav(page, "notes"); expect(page.locator("#notes-list .record-open")).to_contain_text("课堂笔记")
    assert not errors, errors
    context.close()


def test_repeating_tasks(browser):
    context, page, errors = context_page(browser, 1440, 1000)
    new_tagged(page, "月末回顾", "习惯", "monthly", "2026-08-31")
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    page.locator("#user-task-list [data-entry-check]").check()
    expect(page.locator("#toast-message")).to_contain_text("下一次")
    page.locator("#toast-action").click()
    expect(page.locator("#toast-message")).to_have_text("已撤销完成")
    expect(page.locator("#user-task-list [data-entry-check]")).to_have_count(1)
    page.locator("#user-task-list [data-entry-check]").check()
    expect(page.locator("#user-task-list [data-entry-check]")).to_have_count(2)
    result = export_data(page)
    assert result["version"] == 6
    open_item = next(item for item in result["items"] if item["status"] == "open")
    assert open_item["dateOnly"] == "2026-09-30" and open_item["tags"] == ["习惯"]
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    page.locator("[data-task-group='later'] .task-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#quick-entry:visible, .tiptap:visible").fill("下一次已经编辑")
    save(page)
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    page.locator("[data-completed-group] summary").click()
    page.locator(".completed-group [data-entry-check]").uncheck()
    expect(page.locator("#toast-message")).to_contain_text("下一次待办已修改")
    expect(page.locator(".completed-group [data-entry-check]")).to_be_checked()
    page.locator("[data-task-group='later'] [data-entry-check]").check()
    result = export_data(page)
    assert len(result["items"]) == 3
    assert next(item for item in result["items"] if item["status"] == "open")["dateOnly"] == "2026-10-31"
    assert not errors, errors
    context.close()


def test_metadata_drafts_and_backup(browser):
    context, page, errors = context_page(browser, 390, 844)
    begin_compose(page, "task")
    page.locator("#quick-entry:visible, .tiptap:visible").fill("草稿保留标签及周期")
    page.locator("#entry-organization summary").click(); page.locator("#entry-tags").fill("字" * 21)
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("20")
    expect(page.locator("#entry-tags")).to_be_focused()
    page.locator("#entry-tags").fill("学习，复习")
    page.locator("[data-entry-type='task']").click()
    page.locator("#entry-repeat").select_option("weekly")
    page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("选择日期")
    page.locator("#entry-date").fill("2026-08-31")
    page.keyboard.press("Escape"); expect(page.locator("#compose-layer")).not_to_be_visible()
    page.reload(); ready(page); page.locator("#resume-draft").click()
    expect(page.locator("#entry-tags")).to_have_value("学习，复习")
    expect(page.locator("#entry-repeat")).to_have_value("weekly")
    save(page)
    exported = export_data(page)
    assert exported["items"][0]["repeat"]["frequency"] == "weekly"
    old = {**exported, "version": 3, "items": []}
    upload(page, old); page.locator("#confirm-accept").click(); expect(page.locator("#confirm-dialog")).not_to_be_visible()
    page.locator("#restore-recovery").click(); page.locator("#confirm-accept").click(); expect(page.locator("#confirm-dialog")).not_to_be_visible()
    restored = export_data(page)
    assert restored["items"][0]["tags"] == ["学习", "复习"] and restored["items"][0]["repeat"] == exported["items"][0]["repeat"]
    assert not errors, errors
    context.close()


def test_bulk_conflict(browser):
    context, page, errors = context_page(browser, 1440, 1000)
    compose(page, "标签页冲突原文")
    nav(page, "notes"); page.locator("#organize-toggle").click(); page.locator("#select-visible").click()
    other = context.new_page(); other.goto(BASE_URL); other.wait_for_load_state("networkidle"); ready(other)
    nav(other, "notes"); other.locator("#notes-list .record-open").click()
    other.get_by_role("button", name="编辑", exact=True).click(); other.locator("#quick-entry:visible, .tiptap:visible").fill("另一个标签页的修改"); save(other)
    page.bring_to_front()
    page.locator("[data-bulk-action='pin']").click()
    expect(page.locator("#toast-message")).to_contain_text("本次整理未保存")
    page.locator("#organize-toggle").click()
    result = export_data(page)
    assert result["items"][0]["body"] == "另一个标签页的修改" and not result["items"][0].get("pinned")
    assert not errors, errors
    context.close()


def test_shortcuts_and_offline(browser):
    context, page, errors = context_page(browser, 390, 844, color_scheme="dark")
    page.keyboard.press("/")
    expect(page.get_by_role("searchbox")).to_be_focused()
    page.keyboard.type("n/?")
    expect(page.get_by_role("searchbox")).to_have_value("n/?")
    expect(page.locator("#compose-layer")).not_to_be_visible()
    nav(page, "today"); page.keyboard.press("n")
    page.locator("#quick-entry:visible, .tiptap:visible").fill("快捷键记录")
    page.keyboard.press("Control+Enter"); expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator("#note-editor-page")).not_to_be_visible()
    page.wait_for_function("() => !history.state?.jinrijiModal")
    page.wait_for_function("() => !location.hash.startsWith('#notes/new/') && !location.hash.endsWith('/edit')")
    page.keyboard.press("Alt+3"); expect(page.locator("#view-plan")).to_be_visible()
    page.keyboard.press("?"); expect(page.locator("#keyboard-shortcuts")).to_have_attribute("open", "")
    page.wait_for_function("() => Boolean(navigator.serviceWorker.controller)")
    expect(page.locator("#offline-readiness")).to_contain_text("已就绪")
    context.set_offline(True)
    expect(page.locator("#offline-banner")).to_contain_text("可继续编辑")
    compose(page, "离线仍可整理")
    page.reload(); ready(page)
    expect(page.locator("#offline-banner")).to_be_visible()
    nav(page, "notes"); page.get_by_role("searchbox").fill("离线")
    expect(page.locator("#notes-list .record-open")).to_have_count(1)
    page.locator("#organize-toggle").click(); page.locator("#select-visible").click(); page.locator("[data-bulk-action='pin']").click()
    expect(page.locator("#notes-list .eyebrow")).to_contain_text("置顶")
    settle(page); page.screenshot(path=str(OUTPUT / "offline-organization-mobile.png"), full_page=False)
    context.set_offline(False)
    expect(page.locator("#offline-banner")).not_to_be_visible()
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for test in [test_navigation, test_tags_pins_and_bulk, test_repeating_tasks, test_metadata_drafts_and_backup, test_bulk_conflict, test_shortcuts_and_offline]:
            test(browser); print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("v0.7 organization UI acceptance passed")
