"""v0.8 writing acceptance, using only isolated local browser contexts."""
from pathlib import Path
import json
import sys
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import context_page, nav, save, ready, assert_width, OUTPUT
SELECT_ALL = "Meta+a" if sys.platform == "darwin" else "Control+a"

def more(page):
    if not page.locator(".writer-more").evaluate("e => e.open"):
        page.locator(".writer-more summary").click()


def write_tool(page, name):
    control = page.get_by_role("button", name=name, exact=True)
    # A closing panel can still paint while it is already semantically closed.
    in_menu = page.locator(".writer-more button").evaluate_all("(es,name)=>es.some(e=>e.getAttribute('aria-label')===name)", name)
    if in_menu or not control.is_visible():
        more(page)
    control.click()


def items(page):
    return page.evaluate("""() => new Promise((resolve, reject) => {
      const request = indexedDB.open('jinriji'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result; const read = db.transaction('items').objectStore('items').getAll();
        read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); };
    })""")


def open_note(page, text="", title=""):
    page.keyboard.press("Control+k")
    expect(page.locator(".tiptap")).to_be_visible()
    if title:
        page.locator("#entry-title").fill(title)
    if text:
        page.locator(".tiptap").fill(text)
    page.locator(".writer-more summary").click()


def test_autosave_tools(browser):
    context, page, errors = context_page(browser)
    open_note(page, "春天来了\n今天写一点", "安静写作")
    page.locator(".tiptap").press(SELECT_ALL)
    page.get_by_role("button", name="加粗", exact=True).click()
    expect(page.locator(".tiptap strong").first).to_be_visible()
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    record = items(page)[0]
    assert record["body"] == "春天来了\n今天写一点" and record["document"]["type"] == "doc"
    write_tool(page, "查找替换")
    page.locator("#writer-find-text").fill("春天")
    page.locator("#writer-replace-text").fill("秋天")
    page.get_by_role("button", name="全部替换", exact=True).click()
    expect(page.locator(".tiptap")).to_contain_text("秋天来了")
    page.get_by_role("button", name="撤销", exact=True).click()
    expect(page.locator(".tiptap")).to_contain_text("春天来了")
    page.get_by_role("button", name="重做", exact=True).click()
    expect(page.locator(".tiptap")).to_contain_text("秋天来了")
    page.get_by_role("button", name="关闭查找", exact=True).click()
    more(page)
    with page.expect_download() as download:
        page.locator("#writer-export").select_option("md")
    text = Path(download.value.path()).read_text()
    assert "# 安静写作" in text and "**秋天来了**" in text
    write_tool(page, "衬线正文")
    assert "Noto Serif" in page.locator(".tiptap").evaluate("e => getComputedStyle(e).fontFamily")
    write_tool(page, "专注写作")
    page.screenshot(path=str(OUTPUT / "writing-desktop.png"))
    # Close before debounce: it must flush the current text.
    page.locator(".tiptap").fill("立即离开也会保存")
    page.get_by_role("button", name="返回记录").click()
    expect(page.locator("#note-editor-page")).not_to_be_visible()
    assert items(page)[0]["body"] == "立即离开也会保存"
    page.reload(); ready(page); nav(page, "notes")
    page.locator("#notes-list .record-open").click()
    expect(page.locator(".detail-body")).to_have_text("立即离开也会保存")
    assert not errors, errors
    context.close()


def test_history(browser):
    context, page, errors = context_page(browser)
    open_note(page, "第一版正文", "版本测试"); save(page)
    nav(page, "notes"); page.locator("#notes-list .record-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator(".tiptap").fill("第二版正文"); save(page)
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator(".writer-more summary").click()
    write_tool(page, "历史版本")
    expect(page.locator("#history-preview")).to_have_text("第一版正文")
    page.get_by_role("button", name="恢复此版本", exact=True).click()
    page.locator("#confirm-accept").click()
    expect(page.locator(".tiptap")).to_have_text("第一版正文")
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    save(page)
    assert items(page)[0]["body"] == "第一版正文"
    assert not errors, errors
    context.close()


def test_slow_save_and_position(browser):
    context, page, errors = context_page(browser)
    open_note(page)
    # Hold a genuine IDB write transaction while the user keeps typing in the editor.
    page.evaluate("""() => new Promise(resolve => {
      const request = indexedDB.open('jinriji'); request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('items', 'readwrite'); window.holdWriting = true;
        const pulse = () => { const read = tx.objectStore('items').get('none'); read.onsuccess = () => { if (window.holdWriting) pulse(); }; };
        tx.oncomplete = () => db.close(); pulse(); resolve();
      };
    })""")
    page.locator(".tiptap").fill("保存中的第一段")
    expect(page.locator("#draft-status")).to_have_text("保存中…")
    page.locator(".tiptap").fill("继续输入的最终内容")
    page.wait_for_timeout(900)
    page.evaluate("window.holdWriting = false")
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    assert items(page)[0]["body"] == "继续输入的最终内容"
    page.locator(".tiptap").press("ArrowLeft")
    page.locator(".tiptap").press("ArrowLeft")
    offset = page.evaluate("getSelection().anchorOffset")
    save(page); nav(page, "notes"); page.locator("#notes-list .record-open").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    expect(page.locator(".tiptap")).to_be_focused()
    assert page.evaluate("getSelection().anchorOffset") == offset
    save(page)
    assert not errors, errors
    context.close()


def test_ime_and_recovery(browser):
    context, page, errors = context_page(browser, 390, 844)
    open_note(page)
    page.locator(".tiptap").dispatch_event("compositionstart")
    page.locator(".tiptap").fill("正在输入中文")
    page.wait_for_timeout(900)
    assert not items(page), "must not save an unfinished IME composition"
    page.locator(".tiptap").dispatch_event("compositionend")
    expect(page.locator("#draft-status")).to_have_text("已保存到本机")
    # Force only item writes to fail, leaving a real IndexedDB recovery draft.
    page.evaluate("""() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'items') throw new DOMException('test quota', 'QuotaExceededError');
        return original.apply(this, args);
      };
    }""")
    page.locator(".tiptap").fill("失败后恢复这一段")
    expect(page.locator("#entry-error")).to_contain_text("存储空间不足")
    page.get_by_role("button", name="返回记录").click()
    expect(page.locator("#note-editor-page")).to_be_visible()
    assert items(page)[0]["body"] == "正在输入中文"
    page.on("dialog", lambda dialog: dialog.accept())
    page.reload(); ready(page)
    expect(page.locator("#note-editor-page")).to_be_visible()
    expect(page.locator(".tiptap")).to_have_text("失败后恢复这一段")
    save(page)
    assert items(page)[0]["body"] == "失败后恢复这一段"
    assert not errors, errors
    context.close()


def test_paste_and_length(browser):
    context, page, errors = context_page(browser)
    open_note(page)
    page.locator(".tiptap").evaluate("""e => {
      const data = new DataTransfer(); data.setData('text/html', '<p style="color:white;background:red"><b>安全正文</b><a href="javascript:alert(1)">链接</a><img src=x onerror="alert(1)"></p>');
      data.setData('text/plain', '安全正文链接'); e.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, clipboardData:data }));
    }""")
    expect(page.locator(".tiptap")).to_contain_text("安全正文")
    assert page.locator(".tiptap img,.tiptap [style],.tiptap a[href^='javascript']").count() == 0
    write_tool(page, "纯文本粘贴")
    page.locator(".tiptap").press(SELECT_ALL)
    page.locator(".tiptap").evaluate("""e => {
      const data = new DataTransfer(); data.setData('text/html', '<h1>不是标题</h1>'); data.setData('text/plain', '# 原样粘贴');
      e.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, clipboardData:data }));
    }""")
    expect(page.locator(".tiptap")).to_have_text("# 原样粘贴")
    assert page.locator(".tiptap h1").count() == 0
    for size in [10_000, 50_000, 200_000]:
        page.locator(".tiptap").fill("文" * size)
        expect(page.locator("#draft-status")).to_have_text("已保存到本机", timeout=15000)
        assert len(items(page)[0]["body"]) == size
    page.locator(".tiptap").press("End")
    page.locator(".tiptap").press("a")
    expect(page.locator("#entry-error")).to_contain_text("200,000")
    assert len(page.locator(".tiptap").inner_text()) == 200_000
    save(page)
    assert not errors, errors
    context.close()


def test_layouts(browser):
    for width, height, color, scale in [(320, 700, "light", 1), (390, 844, "dark", 1), (768, 1024, "light", 2), (1440, 960, "dark", 1), (667, 375, "dark", 1)]:
        context, page, errors = context_page(browser, width, height, color_scheme=color, reduced_motion="reduce")
        if scale == 2:
            page.add_style_tag(content="html { font-size:200% !important; }")
        open_note(page, "安静地写下今天。\n行文有余地，思绪有着落。", "今日随笔")
        write_tool(page, "衬线正文")
        page.locator(".tiptap").click()
        assert_width(page)
        page.locator("#save-entry").scroll_into_view_if_needed()
        expect(page.locator("#save-entry")).to_be_in_viewport()
        page.screenshot(path=str(OUTPUT / f"writing-{width}-{color}-{scale}x.png"))
        save(page)
        assert not errors, errors
        context.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for test in [test_autosave_tools, test_history, test_slow_save_and_position, test_ime_and_recovery, test_paste_and_length, test_layouts]:
            test(browser); print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("Writing acceptance passed")
