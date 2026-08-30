from pathlib import Path
from playwright.sync_api import sync_playwright


OUTPUT = Path("/Users/zhou/Documents/Codex/2026-08-30/new-chat/outputs")
OUTPUT.mkdir(parents=True, exist_ok=True)


def verify_desktop(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto("http://127.0.0.1:4173")
    page.wait_for_load_state("networkidle")
    assert page.get_by_role("heading", name="八月三十，星期日").is_visible()
    assert page.locator(".sidebar").is_visible()
    assert page.locator(".context-panel").is_visible()
    page.get_by_role("button", name="记录", exact=True).first.click()
    assert page.get_by_role("heading", name="记录", exact=True).is_visible()
    page.get_by_role("button", name="新建记录").click()
    page.locator("#quick-entry").fill("为今日记写下第一条新记录")
    page.get_by_role("button", name="保存记录").click()
    assert page.locator(".note-card p", has_text="为今日记写下第一条新记录").first.is_visible()
    page.get_by_role("button", name="转为待办").click()
    assert page.locator("[data-plan-panel='tasks']").is_visible()
    assert page.locator("#user-task-list", has_text="为今日记写下第一条新记录").is_visible()
    page.get_by_role("tab", name="课程表").click()
    assert page.locator("[data-plan-panel='courses']").is_visible()
    page.screenshot(path=str(OUTPUT / "jinriji-desktop.png"), full_page=True)
    assert not errors, f"console errors: {errors}"
    page.close()


def verify_mobile(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.goto("http://127.0.0.1:4173")
    page.wait_for_load_state("networkidle")
    page.evaluate("localStorage.clear()")
    page.reload()
    assert page.locator(".mobile-nav").is_visible()
    assert page.locator(".mobile-nav [data-view]").count() == 4
    assert not page.locator(".sidebar").is_visible()
    assert page.locator(".mobile-quick-add").evaluate("element => Math.min(element.getBoundingClientRect().width, element.getBoundingClientRect().height)") >= 44
    page.locator(".mobile-quick-add").click()
    assert page.get_by_role("dialog").is_visible()
    page.locator("#quick-entry").fill("移动端快速记录")
    page.get_by_role("button", name="保存记录").click()
    page.locator(".mobile-nav [data-view='notes']").click()
    assert page.locator(".note-card p", has_text="移动端快速记录").first.is_visible()
    assert "is-active" in page.locator(".mobile-nav [data-view='notes']").get_attribute("class")
    page.locator(".mobile-nav [data-view='today']").click()
    page.wait_for_timeout(500)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.screenshot(path=str(OUTPUT / "jinriji-mobile.png"), full_page=True)
    page.close()


def verify_tablet(browser):
    page = browser.new_page(viewport={"width": 768, "height": 1024}, device_scale_factor=1)
    page.goto("http://127.0.0.1:4173")
    page.wait_for_load_state("networkidle")
    assert page.locator(".sidebar").is_visible()
    assert not page.locator(".context-panel").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.get_by_role("button", name="计划", exact=True).first.click()
    assert page.locator(".week-board").is_visible()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUTPUT / "jinriji-tablet.png"), full_page=True)
    page.close()


def verify_accessibility_modes(browser):
    page = browser.new_page(viewport={"width": 375, "height": 812}, device_scale_factor=1)
    page.emulate_media(color_scheme="dark", reduced_motion="reduce")
    page.goto("http://127.0.0.1:4173")
    page.wait_for_load_state("networkidle")
    page.evaluate("document.documentElement.style.fontSize = '125%'")
    assert page.locator(".mobile-nav").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    assert page.locator(".mobile-nav [data-view]").first.evaluate("element => Math.min(element.getBoundingClientRect().width, element.getBoundingClientRect().height)") >= 44
    assert page.evaluate("getComputedStyle(document.documentElement).colorScheme") == "dark"
    page.screenshot(path=str(OUTPUT / "jinriji-dark-accessible.png"), full_page=True)
    page.close()

    landscape = browser.new_page(viewport={"width": 667, "height": 375}, device_scale_factor=1)
    landscape.goto("http://127.0.0.1:4173")
    landscape.wait_for_load_state("networkidle")
    assert landscape.locator(".mobile-nav").is_visible()
    assert landscape.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    landscape.screenshot(path=str(OUTPUT / "jinriji-mobile-landscape.png"), full_page=False)
    landscape.close()


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True)
    verify_desktop(chromium)
    verify_mobile(chromium)
    verify_tablet(chromium)
    verify_accessibility_modes(chromium)
    chromium.close()

print("UI acceptance passed: desktop + tablet + mobile + dark/reduced-motion + landscape")
