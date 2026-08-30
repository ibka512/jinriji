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
    page.screenshot(path=str(OUTPUT / "jinriji-desktop-v0.png"), full_page=True)
    assert not errors, f"console errors: {errors}"
    page.close()


def verify_mobile(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.goto("http://127.0.0.1:4173")
    page.wait_for_load_state("networkidle")
    page.evaluate("localStorage.clear()")
    page.reload()
    assert page.locator(".mobile-nav").is_visible()
    assert not page.locator(".sidebar").is_visible()
    page.locator(".mobile-create").click()
    assert page.get_by_role("dialog").is_visible()
    page.locator("#quick-entry").fill("移动端快速记录")
    page.get_by_role("button", name="保存记录").click()
    page.locator(".mobile-nav [data-view='notes']").click()
    assert page.locator(".note-card p", has_text="移动端快速记录").first.is_visible()
    page.locator(".mobile-nav [data-view='today']").click()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUTPUT / "jinriji-mobile-v0.png"), full_page=True)
    page.close()


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True)
    verify_desktop(chromium)
    verify_mobile(chromium)
    chromium.close()

print("UI acceptance passed: desktop + mobile")
