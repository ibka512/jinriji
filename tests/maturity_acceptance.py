"""v0.10 safety, feedback and realistic scale. Isolated local Chromium contexts only."""
import json
from pathlib import Path
from time import perf_counter
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import BASE_URL, OUTPUT, context_page, ready, nav, upload, save, assert_width
from writing_acceptance import items, open_note, write_tool, more
from timetable_acceptance import fixture, load_fixture, study_save, export_data

STAMP = "2026-08-31T04:00:00.000Z"


def record(key, title, body="", **extra):
    return dict(id=key, title=title, body=body or title, kind="note", status="open", allDay=False,
                reminderOffsets=[], revision=1, createdAt=STAMP, updatedAt=STAMP, **extra)


def payload(records, notebooks=None, assets=None):
    return dict(version=6, exportedAt=STAMP, theme="sage", glass=True, items=records, courses=[], terms=[],
                recurrenceRules=[], occurrenceExceptions=[], notebooks=notebooks or [], assets=assets or [])


def import_fixture(page, data):
    nav(page, "settings"); upload(page, data)
    page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()


def test_document_fidelity(browser):
    context, page, errors = context_page(browser, 390, 844)
    # Build a valid local fixture with the same nodes used by real note editing.
    encoded = page.evaluate("""() => {const c=document.createElement('canvas');c.width=64;c.height=64;
      const ctx=c.getContext('2d');ctx.fillStyle='#667b68';ctx.fillRect(0,0,64,64);return c.toDataURL('image/png');}""")
    doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "链接", "marks": [{"type": "noteLink", "attrs": {"noteId": "index"}}]}]},
        {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "原单元格"}]}]}]}]},
        {"type": "localImage", "attrs": {"assetId": "image", "alt": "图片"}},
        {"type": "paragraph", "content": [{"type": "text", "text": "末段"}]}]}
    # The application's public backup format requires a canonical text projection.
    source = record("source", "保留原文", "链接\n原单元格\n\n\n末段", document=doc)
    import_fixture(page, payload([record("index", "索引"), source], assets=[dict(id="image", dataUrl=encoded, width=64, height=64, createdAt=STAMP)]))
    nav(page, "notes"); page.locator('#notes-list [data-entry-open="source"]').click()
    page.get_by_role("button", name="创建关联待办", exact=True).click()
    expect(page.locator("#toast-message")).to_have_text("已创建待办，原文保留")
    task = next(item for item in items(page) if item["kind"] == "task")
    assert task["sourceNoteId"] == "source"
    page.locator("#toast-action").click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.locator("#quick-entry").fill("独立的执行步骤"); save(page)
    assert next(item for item in items(page) if item["id"] == "source")["document"] == doc
    # Simulate a document-bearing task created by a previous version; edit must retain all nodes.
    legacy = {**source, "id": "legacy", "kind": "task", "title": "旧版富文本待办"}
    import_fixture(page, payload([record("index", "索引"), legacy], assets=[dict(id="image", dataUrl=encoded, width=64, height=64, createdAt=STAMP)]))
    nav(page, "notes"); page.locator('#notes-list [data-entry-open="legacy"]').click()
    page.get_by_role("button", name="编辑", exact=True).click()
    expect(page.locator("#quick-entry")).not_to_be_visible()
    page.locator(".tiptap > p").last.click(); page.keyboard.press("End"); page.keyboard.type(" additional")
    save(page)
    saved = next(item for item in items(page) if item["id"] == "legacy")
    nodes = saved["document"]["content"]
    assert [node["type"] for node in nodes[:3]] == ["paragraph", "table", "localImage"]
    assert nodes[0]["content"][0]["marks"][0]["attrs"]["noteId"] == "index"
    assert nodes[1]["content"][0]["content"][0]["content"][0]["content"][0]["text"] == "原单元格"
    assert nodes[2]["attrs"]["assetId"] == "image" and "additional" in saved["body"]
    assert not errors, errors
    context.close()


def test_schedule_dates(browser):
    context, page, errors = context_page(browser)
    undated = {**record("undated", "旧版未排日期"), "kind": "event"}
    import_fixture(page, payload([undated])); nav(page, "plan")
    expect(page.locator("#unscheduled-events")).to_contain_text("旧版未排日期")
    page.locator("#unscheduled-events button").click(); page.locator("#save-entry").click()
    expect(page.locator("#entry-error")).to_contain_text("请选择日程日期")
    expect(page.locator("#entry-date")).to_be_focused()
    page.locator("#entry-date").fill("2026-08-31"); save(page)
    expect(page.locator("#unscheduled-events")).not_to_be_visible()
    page.get_by_role("button", name="下一周", exact=True).click()
    page.locator("#view-plan .page-header [data-open-compose]").click()
    expect(page.locator("#entry-date")).to_have_value("2026-09-07")
    page.get_by_role("button", name="返回计划").click()
    expect(page.locator("#entry-editor-page")).not_to_be_visible()
    page.wait_for_function("() => !history.state?.jinrijiModal")
    page.get_by_role("button", name="在 2026-09-09 添加日程", exact=True).click()
    expect(page.locator("#entry-date")).to_have_value("2026-09-09")
    assert not errors, errors
    context.close()


def test_notebook_scope_and_search(browser):
    context, page, errors = context_page(browser, 390, 844)
    books = [dict(id=key, name=name, revision=1, createdAt=STAMP, updatedAt=STAMP) for key, name in [("a", "课堂"), ("b", "生活")]]
    import_fixture(page, payload([record("one", "甲", "前文" * 200 + "命中ＡＢＣ<script>" + "后文", notebookId="a"), record("two", "乙", notebookId="b")], books))
    nav(page, "notes"); page.locator("#notebook-filter").select_option("a")
    untouched = next(item for item in items(page) if item["id"] == "two")
    page.locator("#organize-toggle").click(); page.locator("#select-visible").click()
    expect(page.locator("#selection-count")).to_have_text("已选 1 项")
    page.locator('[data-bulk-action="notebook"]').click(); page.locator("#bulk-notebook").select_option("b")
    page.locator('[data-bulk-action="notebook"]').click()
    expect(page.locator("#notes-list")).to_contain_text("没有符合筛选")
    assert next(item for item in items(page) if item["id"] == "two") == untouched
    page.locator("[data-clear-filters]").click(); page.locator("#search-records").fill("abc")
    expect(page.locator("#notes-list mark")).to_have_text("ABC")
    expect(page.locator("#notes-list script")).to_have_count(0)
    page.locator("#search-records").fill("")
    page.locator("#notebook-filter").select_option("b"); page.reload(); ready(page)
    expect(page.locator("#notebook-filter")).to_have_value("b")
    assert not errors, errors
    context.close()


def test_course_creation_flow(browser):
    context, page, errors = context_page(browser, 390, 844)
    load_fixture(page)
    page.get_by_role("button", name="添加课程", exact=True).click()
    expect(page.locator("#study-term")).to_have_value("term")
    page.locator("#study-name").fill("一步排课")
    page.locator("#study-time-end").fill("08:00"); page.locator("#study-save").click()
    expect(page.locator("#study-error")).to_contain_text("下课时间")
    page.locator("#study-time-end").fill("10:00"); study_save(page)
    expect(page.locator("#user-course-list")).to_contain_text("一步排课")
    page.locator("#user-course-list .record-open").filter(has_text="一步排课").click()
    assert "#plan/course/" in page.url
    expect(page.locator("#view-plan")).to_be_visible(); expect(page.locator(".rule-row")).to_contain_text("09:00–10:00")
    page.reload(); ready(page); expect(page.locator("#detail-title")).to_have_text("一步排课")
    page.locator("[data-detail-back]").click(); expect(page.get_by_role("tab", name="课程表", exact=True)).to_be_visible()
    data = export_data(page)
    assert len(data["courses"]) == 3 and len(data["recurrenceRules"]) == 4
    assert not errors, errors
    context.close()


def test_feedback_and_update(browser):
    context, page, errors = context_page(browser, 390, 844, reduced_motion="reduce")
    import_fixture(page, payload([{**record("task", "待办"), "kind": "task"}]))
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    page.locator("#user-task-list input").check(); page.locator("#toast-action").click()
    expect(page.locator("#toast-message")).to_have_text("已撤销完成"); expect(page.locator("#toast")).to_be_visible()
    page.mouse.move(0, 800)
    page.clock.run_for(5600)
    expect(page.locator("#toast")).to_be_hidden(); assert page.locator("#toast").evaluate("e => e.inert")
    nav(page, "settings"); expect(page.locator("#app-version")).to_contain_text(json.loads((Path(__file__).resolve().parents[1] / "package.json").read_text())["version"])
    page.locator("#check-update").click(); expect(page.locator("#app-update-status")).to_contain_text("已检查")
    context.set_offline(True); page.locator("#check-update").click()
    expect(page.locator("#app-update-status")).to_contain_text("联网后重试")
    assert not errors, errors
    context.close()


def test_startup_error(browser):
    context = browser.new_context(); page = context.new_page()
    page.add_init_script("IDBFactory.prototype.open = () => { throw new DOMException('test unavailable','InvalidStateError'); }")
    page.goto(BASE_URL)
    expect(page.locator("body")).to_have_attribute("data-app-ready", "error")
    expect(page.get_by_role("heading", name="暂时无法打开记录")).to_be_visible()
    expect(page.get_by_role("button", name="重新加载")).to_be_visible()
    expect(page.locator(".startup-error")).to_contain_text("本次没有清除数据")
    assert page.locator(".sidebar").evaluate("e => e.inert")
    context.close()


def test_scale_and_geometry(browser):
    metrics = []
    for size in [500, 2000]:
        context, page, errors = context_page(browser, 1440, 1000)
        records = [record(f"r{i}", f"笔记 {i:04}", "日常阅读与记录。" * 120 + ("唯一检索词" if i == size - 1 else "")) for i in range(size)]
        start = perf_counter(); import_fixture(page, payload(records)); nav(page, "notes")
        expect(page.locator("#notes-list .record-open")).to_have_count(80)
        import_ms = round((perf_counter() - start) * 1000)
        start = perf_counter(); page.locator("#search-records").fill("唯一检索词")
        expect(page.locator("#notes-list .record-open")).to_have_count(1)
        search_ms = round((perf_counter() - start) * 1000)
        expect(page.locator("#notes-list mark")).to_have_text("唯一检索词")
        metrics.append(dict(records=size, import_and_navigate_ms=import_ms, search_interaction_ms=search_ms))
        assert search_ms < 2000, metrics
        page.locator("#search-records").fill(""); page.locator("#load-more-records").click()
        expect(page.locator("#notes-list .record-open")).to_have_count(160)
        assert_width(page); assert not errors, errors; context.close()
    print("SCALE " + json.dumps(metrics), flush=True)
    for width, height in [(320, 700), (390, 844), (768, 1024), (1440, 1000)]:
        context, page, errors = context_page(browser, width, height, color_scheme="dark", reduced_motion="reduce")
        open_note(page, "正文中的第一行", "排版一致性"); save(page)
        read_title = page.locator("#detail-title").bounding_box(); read_body = page.locator(".detail-body p").bounding_box()
        page.get_by_role("button", name="编辑", exact=True).click()
        expect(page.locator("#note-editor-page")).to_be_visible()
        edit_title = page.locator("#entry-title").bounding_box(); edit_body = page.locator(".tiptap p").bounding_box()
        assert abs(read_title["x"] - edit_title["x"]) < 2
        assert abs(read_body["y"] - edit_body["y"]) < 12, (width, read_body, edit_body)
        page.locator(".tiptap").fill("长文的一行\n" * 120)
        page.locator(".tiptap").press("Control+End")
        expect(page.locator("#save-entry")).to_be_in_viewport()
        more(page); assert_width(page)
        expect(page.locator('[data-write="undo"]')).to_be_in_viewport()
        page.screenshot(path=str(OUTPUT / f"maturity-writer-{width}.png"))
        assert not errors, errors; context.close()


def test_image_scale(browser):
    context, page, errors = context_page(browser)
    encoded = page.evaluate("""() => {
      const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d');
      const pixels=ctx.createImageData(256,256);let seed=42;
      for(let i=0;i<pixels.data.length;i+=4){for(let j=0;j<3;j++){seed=(1664525*seed+1013904223)>>>0;pixels.data[i+j]=seed>>>24;}pixels.data[i+3]=255;}
      ctx.putImageData(pixels,0,0);return c.toDataURL('image/png');
    }""")
    metrics = []
    for count in [1, 20]:
        assets = [dict(id=f"asset{i}", dataUrl=encoded, width=256, height=256, createdAt=STAMP) for i in range(count)]
        doc = dict(type="doc", content=[dict(type="localImage", attrs=dict(assetId=asset["id"], alt="验收图片")) for asset in assets] + [dict(type="paragraph", content=[dict(type="text", text="影像")])])
        import_fixture(page, payload([record("album", "图集", "\n" * (2 * count) + "影像", document=doc)], assets=assets))
        nav(page, "notes"); page.locator('#notes-list [data-entry-open="album"]').click()
        start = perf_counter(); page.reload(); ready(page)
        page.wait_for_function("() => [...document.querySelectorAll('.detail-body img')].every(img => img.naturalWidth === 256)")
        expect(page.locator(".detail-body img")).to_have_count(count)
        metrics.append(dict(images=count, asset_bytes=len(encoded)*count, reload_ms=round((perf_counter()-start)*1000)))
        page.get_by_role("button", name="编辑", exact=True).click(); more(page)
        expect(page.locator(".writer-export-hint")).to_contain_text("不含图片文件")
        save(page)
    print("IMAGE_SCALE " + json.dumps(metrics), flush=True)
    assert not errors, errors; context.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for test in [test_document_fidelity, test_schedule_dates, test_notebook_scope_and_search, test_course_creation_flow,
                     test_feedback_and_update, test_startup_error, test_scale_and_geometry, test_image_scale]:
            test(browser); print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("Maturity acceptance passed")
