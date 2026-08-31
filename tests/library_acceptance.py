"""v0.9: page editor, notebooks, links, selected tasks, local media and navigation guards."""
import base64
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import context_page, nav, save, ready, assert_width, OUTPUT, BASE_URL, upload
from writing_acceptance import items, open_note, SELECT_ALL
from timetable_acceptance import export_data


def more(page):
    if not page.locator(".writer-more").evaluate("e => e.open"):
        page.locator(".writer-more summary").click()


def test_notebooks_templates(browser):
    context, page, errors = context_page(browser)
    nav(page, "notes")
    page.locator("#manage-notebooks").click()
    page.locator("#notebook-name").fill("课堂")
    page.locator("#notebook-form button[type='submit']").click()
    expect(page.locator("#notebook-rows")).to_contain_text("课堂")
    book_id = page.locator("[data-rename-book]").get_attribute("data-rename-book")
    page.locator("#notebook-cancel").click()
    page.locator("#notebook-filter").select_option(book_id)
    page.locator("#new-note-template").select_option("lecture")
    expect(page.locator("#note-editor-page")).to_be_visible()
    expect(page.locator("dialog[open]")).to_have_count(0)
    expect(page.locator(".tiptap")).to_contain_text("理解与例子")
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    assert items(page)[0]["notebookId"] == book_id
    page.screenshot(path=str(OUTPUT / "library-desktop-editor.png"))
    save(page)
    page.locator("#manage-notebooks").click()
    page.locator("[data-rename-book]").click()
    page.locator("#notebook-name").fill("文学课")
    page.locator("#notebook-form button[type='submit']").click()
    expect(page.locator("#notebook-rows")).to_contain_text("文学课")
    page.locator("[data-delete-book]").click(); page.locator("#confirm-accept").click()
    expect(page.locator("#notebook-rows")).to_contain_text("还没有笔记本")
    assert not items(page)[0].get("notebookId") and not items(page)[0].get("deletedAt")
    assert not errors, errors
    context.close()


def test_links_selected_tasks(browser):
    context, page, errors = context_page(browser)
    open_note(page, "先整理知识", "知识索引"); save(page)
    open_note(page, "需要复习这一节", "课堂复习")
    page.locator(".tiptap").press(SELECT_ALL)
    page.get_by_role("button", name="选段转待办", exact=True).click()
    expect(page.locator("#toast-message")).to_contain_text("已加入待办")
    data = items(page); task = next(item for item in data if item["kind"] == "task")
    note = next(item for item in data if item["title"] == "课堂复习")
    assert task["sourceNoteId"] == note["id"] and note["body"] == "需要复习这一节"
    page.locator(".tiptap").press(SELECT_ALL)
    page.get_by_role("button", name="链接笔记", exact=True).click()
    page.locator("#note-link-search").fill("知识索引")
    page.locator("[data-insert-note]").click()
    expect(page.locator(".tiptap a[data-note-id]")).to_have_text("需要复习这一节")
    save(page)
    page.locator(".detail-body a[data-note-id]").click()
    expect(page.locator("#detail-title")).to_have_text("知识索引")
    expect(page.locator(".note-backlinks")).to_contain_text("课堂复习")
    page.locator(".note-backlinks button").click()
    expect(page.locator(".note-backlinks")).to_contain_text("需要复习这一节")
    page.locator(".note-backlinks button").click()
    page.get_by_role("button", name="查看来源笔记 →", exact=True).click()
    expect(page.locator("#detail-title")).to_have_text("课堂复习")
    assert not errors, errors
    context.close()


def test_image_table_backup(browser):
    context, page, errors = context_page(browser)
    open_note(page, "表格和图片", "课堂资料")
    page.locator(".tiptap").press("End")
    page.get_by_role("button", name="插入表格", exact=True).click()
    expect(page.locator(".tiptap table tr")).to_have_count(3)
    page.locator(".tiptap table th p").first.click(); page.keyboard.type("Topic")
    page.get_by_role("button", name="在下方添加行", exact=True).click()
    expect(page.locator(".tiptap table tr")).to_have_count(4)
    page.get_by_role("button", name="在右侧添加列", exact=True).click()
    expect(page.locator(".tiptap table tr").first.locator("th,td")).to_have_count(4)
    page.get_by_role("button", name="删除当前列", exact=True).click()
    expect(page.locator(".tiptap table tr").first.locator("th,td")).to_have_count(3)
    page.locator(".tiptap > p").last.click()
    encoded = page.evaluate("""() => { const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=320; const c=canvas.getContext('2d'); c.fillStyle='#64755e'; c.fillRect(0,0,640,320); return canvas.toDataURL('image/png').split(',')[1]; }""")
    page.locator("#writer-image").set_input_files({"name": "课堂示意.png", "mimeType": "image/png", "buffer": base64.b64decode(encoded)})
    expect(page.locator(".tiptap img")).to_be_visible()
    page.wait_for_function("() => document.querySelector('.tiptap img')?.naturalWidth > 0")
    save(page)
    expect(page.locator(".detail-body table")).to_be_visible()
    expect(page.locator(".detail-body img")).to_be_visible()
    data = export_data(page)
    assert data["version"] == 6 and len(data["assets"]) == 1
    upload(page, {**data, "items": [], "assets": []}); page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    upload(page, data); page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    nav(page, "notes"); page.locator("#notes-list .record-open").click()
    page.wait_for_function("() => document.querySelector('.detail-body img')?.naturalWidth > 0")
    page.screenshot(path=str(OUTPUT / "library-image-table.png"))
    if ":5173" not in BASE_URL:
        page.wait_for_function("() => !!navigator.serviceWorker.controller")
        context.set_offline(True); page.reload(); ready(page)
        page.wait_for_function("() => document.querySelector('.detail-body img')?.naturalWidth > 0")
        context.set_offline(False)
    assert not errors, errors
    context.close()


def test_navigation_and_focus(browser):
    context, page, errors = context_page(browser)
    open_note(page, "第一篇", "甲"); save(page)
    first = items(page)[0]["id"]
    open_note(page, "第二篇", "乙"); save(page)
    second = next(item["id"] for item in items(page) if item["title"] == "乙")
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator(".tiptap").fill("立即切换仍保存")
    page.locator(f"#notes-list [data-entry-open='{first}']").click()
    expect(page.locator("#detail-title")).to_have_text("甲")
    assert next(item for item in items(page) if item["id"] == second)["body"] == "立即切换仍保存"
    page.go_back()
    expect(page.locator("#note-editor-page")).to_be_visible()
    expect(page.locator(".tiptap")).to_have_text("立即切换仍保存")
    page.reload(); ready(page)
    expect(page.locator(".tiptap")).to_have_text("立即切换仍保存")
    more(page); page.get_by_role("button", name="专注写作", exact=True).click()
    expect(page.locator(".sidebar")).not_to_be_visible()
    expect(page.locator("#record-browser")).not_to_be_visible()
    page.get_by_role("button", name="专注写作", exact=True).click()
    save(page)
    assert not errors, errors
    context.close()


def test_mobile_read_write(browser):
    for width, height in [(390, 844), (768, 1024), (320, 700)]:
        context, page, errors = context_page(browser, width, height, color_scheme="dark", reduced_motion="reduce")
        open_note(page, "落笔之前，先留一点空白。", "今日随笔")
        expect(page.locator("#entry-title")).to_have_value("今日随笔")
        page.locator(".writer-more summary").click()
        expect(page.locator("dialog[open]")).to_have_count(0)
        expect(page.locator("#record-browser")).not_to_be_visible()
        if width <= 700:
            expect(page.locator(".mobile-tab-area")).not_to_be_visible()
        assert_width(page)
        page.screenshot(path=str(OUTPUT / f"library-page-{width}-dark.png"))
        save(page)
        assert not page.locator(".tiptap:visible").count()
        if width <= 700:
            expect(page.locator(".mobile-tab-area")).to_be_visible()
        page.locator(".detail-body").click()
        expect(page.locator(".tiptap")).to_be_focused()
        page.locator(".tiptap").fill("返回前最后一个字")
        page.get_by_role("button", name="返回记录", exact=True).click()
        expect(page.locator(".detail-body")).to_have_text("返回前最后一个字")
        assert not errors, errors
        context.close()


def test_failed_navigation_guard(browser):
    context, page, errors = context_page(browser)
    open_note(page, "已保存的正文", "安全切换")
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    original_url = page.url
    page.evaluate("""() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'items') throw new DOMException('test quota','QuotaExceededError'); return window.originalPut.apply(this,args);
    }; }""")
    page.locator(".tiptap").fill("不能丢失的最后修改")
    expect(page.locator("#entry-error")).to_contain_text("存储空间不足")
    page.locator("[data-view='today']:visible").click()
    expect(page.locator("#note-editor-page")).to_be_visible()
    assert page.url == original_url
    page.go_back()
    page.wait_for_function("hash => location.href === hash", arg=original_url)
    expect(page.locator(".tiptap")).to_have_text("不能丢失的最后修改")
    assert items(page)[0]["body"] == "已保存的正文"
    page.evaluate("() => { IDBObjectStore.prototype.put = window.originalPut; }")
    nav(page, "today")
    assert items(page)[0]["body"] == "不能丢失的最后修改"
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for test in [test_notebooks_templates, test_links_selected_tasks, test_image_table_backup, test_navigation_and_focus, test_mobile_read_write, test_failed_navigation_guard]:
            test(browser); print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("Library acceptance passed")
