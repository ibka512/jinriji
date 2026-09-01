"""Page-style task and schedule editor acceptance. Run against a local production build."""
from playwright.sync_api import expect, sync_playwright

from ui_acceptance import BASE_URL, OUTPUT, assert_width, context_page, nav


def open_plan_editor(page, kind):
    nav(page, "plan")
    page.get_by_role("tab", name="待办" if kind == "task" else "本周", exact=True).click()
    page.locator("#view-plan .page-header [data-open-compose]:visible, .mobile-quick-add:visible").click()
    editor = page.locator("#entry-editor-page")
    expect(editor).to_be_visible()
    expect(editor).to_have_attribute("data-entry-kind", kind)
    expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator("dialog[open]")).to_have_count(0)
    expect(page.locator(".compose-options")).not_to_be_visible()
    expect(page.locator("body")).to_have_class("entry-writing")
    return editor


def test_desktop_schedule(browser):
    context, page, errors = context_page(browser, 1440, 1000)
    editor = open_plan_editor(page, "schedule")
    expect(page.locator(".sidebar")).to_be_visible()
    expect(page.locator(".context-panel")).not_to_be_visible()
    expect(page.locator("#view-plan")).not_to_be_visible()
    expect(page.locator("#entry-title")).to_have_attribute("placeholder", "日程标题")
    page.locator("#entry-title").fill("研讨会")
    page.locator("#quick-entry").fill("整理问题与资料")
    page.locator("#entry-organization summary").click()
    expect(page.locator("#entry-date")).to_be_visible()
    expect(page.locator("#entry-date")).not_to_have_value("")
    assert editor.evaluate("e => getComputedStyle(e).position") != "fixed"
    assert_width(page)
    page.screenshot(path=str(OUTPUT / "schedule-editor-page-desktop.png"), full_page=True)
    page.locator(".sidebar [data-view='today']").click()
    expect(editor).not_to_be_visible()
    expect(page.locator("#view-today")).to_be_visible()
    page.go_back()
    expect(page.locator("#view-plan")).to_be_visible()
    expect(editor).not_to_be_visible()
    assert not errors, errors
    context.close()


def test_mobile_task_draft(browser):
    context, page, errors = context_page(browser, 390, 844)
    open_plan_editor(page, "task")
    expect(page.locator(".mobile-tab-area")).not_to_be_visible()
    page.locator("#entry-title").fill("整理书桌")
    page.locator("#quick-entry").fill("先收文件，再擦桌面")
    expect(page.locator("#draft-status")).to_have_text("已暂存")
    assert_width(page)
    page.screenshot(path=str(OUTPUT / "task-editor-page-mobile.png"), full_page=True)
    page.go_back()
    expect(page.locator("#entry-editor-page")).not_to_be_visible()
    expect(page.locator("#draft-banner")).to_be_visible()
    page.locator("#resume-draft").click()
    expect(page.locator("#entry-editor-page")).to_be_visible()
    expect(page.locator("#entry-title")).to_have_value("整理书桌")
    expect(page.locator("#quick-entry")).to_have_value("先收文件，再擦桌面")
    assert not errors, errors
    context.close()


def test_mobile_schedule_dark(browser):
    context, page, errors = context_page(browser, 390, 844, color_scheme="dark")
    open_plan_editor(page, "schedule")
    page.locator("#quick-entry").fill("晚间阅读")
    page.locator("#entry-organization summary").click()
    expect(page.locator("#entry-date")).to_be_visible()
    assert_width(page)
    page.screenshot(path=str(OUTPUT / "schedule-editor-page-mobile-dark.png"), full_page=True)
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for test in (test_desktop_schedule, test_mobile_task_draft, test_mobile_schedule_dark):
            test(browser)
            print("PASS", test.__name__)
        browser.close()
