"""v0.6 academic/segmented UI regression; isolated local-only browser contexts."""
import json
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import BASE_URL, OUTPUT, context_page, ready, nav, compose, upload, assert_width

STAMP = "2026-08-31T04:00:00.000Z"


def fixture():
    courses = [
        {"id": "course-a", "name": "日本美术史", "location": "文史楼 201", "instructor": "田中老师", "termId": "term", "createdAt": STAMP, "updatedAt": STAMP, "revision": 1},
        {"id": "course-b", "name": "设计基础", "location": "设计楼 302", "termId": "term", "createdAt": STAMP, "updatedAt": STAMP, "revision": 1},
    ]
    return {
        "version": 3, "exportedAt": STAMP, "theme": "sage", "glass": True,
        "items": [], "courses": courses,
        "terms": [{"id": "term", "name": "2026 秋季", "startDate": "2026-08-31", "endDate": "2026-09-27", "totalWeeks": 4, "timeZone": "Asia/Shanghai", "isActive": True}],
        "recurrenceRules": [
            {"id": "rule-a", "courseId": "course-a", "weekday": 1, "startTime": "14:00", "endTime": "15:30", "startWeek": 1, "endWeek": 4, "intervalWeeks": 2},
            {"id": "rule-b", "courseId": "course-b", "weekday": 2, "startTime": "09:00", "endTime": "10:30", "startWeek": 2, "endWeek": 4, "intervalWeeks": 2},
            {"id": "rule-c", "courseId": "course-b", "weekday": 1, "startTime": "14:30", "endTime": "16:00", "startWeek": 1, "endWeek": 4, "intervalWeeks": 1},
        ], "occurrenceExceptions": [],
    }


def load_fixture(page):
    nav(page, "settings"); upload(page, fixture())
    expect(page.locator("#confirm-message")).to_contain_text("1 个学期")
    page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    plan_courses(page)


def plan_courses(page):
    nav(page, "plan"); page.get_by_role("tab", name="课程表", exact=True).click()


def study_save(page):
    page.locator("#study-save").click()
    expect(page.locator("#study-dialog")).not_to_be_visible()
    page.wait_for_function("() => !history.state?.jinrijiModal")


def export_data(page):
    nav(page, "settings")
    with page.expect_download() as download:
        page.locator("#export-data").click()
    return json.loads(download.value.path().read_text())


def test_build_schedule(browser):
    context, page, errors = context_page(browser, 390, 844)
    plan_courses(page)
    page.get_by_role("button", name="新建学期", exact=True).click()
    page.locator("#study-name").fill("我的秋季学期")
    page.locator("#study-start").fill("2026-09-01")
    page.locator("#study-save").click()
    expect(page.locator("#study-error")).to_contain_text("周一")
    expect(page.locator("#study-name")).to_have_value("我的秋季学期")
    page.locator("#study-start").fill("2026-08-31")
    page.locator("#study-weeks").fill("4")
    study_save(page)
    expect(page.locator(".timetable-heading h2")).to_contain_text("第 1 周")
    compose(page, "", "course", title="课堂课程")
    page.locator("#user-course-list .record-open").click()
    page.get_by_role("button", name="添加时段", exact=True).click()
    page.locator("#study-repeat").select_option("odd")
    page.locator("#study-time-start").fill("14:00")
    page.locator("#study-time-end").fill("13:00")
    page.locator("#study-save").click()
    expect(page.locator("#study-error")).to_contain_text("下课时间")
    page.locator("#study-time-end").fill("15:00")
    study_save(page)
    expect(page.locator(".rule-row")).to_contain_text("1–4周 单周")
    page.locator("[data-course-note]").click()
    expect(page.locator("#entry-course")).not_to_have_value("")
    page.locator("#quick-entry").fill("课程关联笔记\n保留正文")
    page.locator("#save-entry").click(); expect(page.locator("#compose-layer")).not_to_be_visible()
    expect(page.locator(".linked-record")).to_contain_text("课程关联笔记")
    page.locator(".linked-record").click()
    expect(page.locator(".course-link")).to_contain_text("课堂课程")
    page.locator(".course-link").click()
    expect(page.locator("#detail-title")).to_have_text("课堂课程")
    plan_courses(page)
    expect(page.locator(".course-day-list")).to_contain_text("课堂课程")
    page.get_by_role("button", name="课程下一周", exact=True).click()
    expect(page.locator(".timetable-heading h2")).to_contain_text("第 2 周")
    expect(page.locator(".course-day-list")).not_to_contain_text("课堂课程")
    page.get_by_role("button", name="课程下一周", exact=True).click()
    expect(page.locator(".course-day-list")).to_contain_text("课堂课程")
    result = export_data(page)
    assert result["version"] == 4 and len(result["terms"]) == 1 and len(result["recurrenceRules"]) == 1
    assert result["items"][0]["courseId"] == result["courses"][0]["id"]
    assert not errors, errors
    context.close()


def test_single_class_adjustment(browser):
    context, page, errors = context_page(browser, 390, 844)
    load_fixture(page)
    page.locator(".course-day-list [data-occurrence-rule='rule-a']").click()
    page.locator("#study-date").fill("2026-09-08")
    page.locator("#study-time-start").fill("15:00")
    page.locator("#study-time-end").fill("16:00")
    page.locator("#study-location").fill("临时教室 202")
    study_save(page)
    expect(page.locator(".course-day-list")).not_to_contain_text("日本美术史")
    page.get_by_role("button", name="课程下一周", exact=True).click()
    page.locator("[data-course-day='2']").click()
    expect(page.locator(".course-day-list")).to_contain_text("临时教室 202")
    expect(page.locator(".course-day-list [data-occurrence-rule='rule-a']")).to_have_count(1)
    page.locator(".course-day-list [data-occurrence-rule='rule-a']").click()
    page.locator("#study-adjustment").select_option("cancelled")
    expect(page.locator("#study-replacement")).not_to_be_visible()
    study_save(page)
    # Cancellation returns to the original occurrence date (which is what is cancelled).
    page.get_by_role("button", name="课程上一周", exact=True).click()
    page.locator("[data-course-day='1']").click()
    expect(page.locator(".course-day-list [data-occurrence-rule='rule-a']")).to_contain_text("已停课")
    page.get_by_role("tab", name="本周", exact=True).click()
    expect(page.locator("#week-agenda")).not_to_contain_text("日本美术史")
    page.get_by_role("tab", name="课程表", exact=True).click()
    page.locator(".course-day-list [data-occurrence-rule='rule-a']").click()
    page.get_by_role("button", name="恢复原安排", exact=True).click()
    page.locator("#confirm-accept").click()
    expect(page.locator("#study-dialog")).not_to_be_visible()
    expect(page.locator(".course-day-list [data-occurrence-rule='rule-a']")).not_to_contain_text("已停课")
    page.locator(".course-day-list [data-occurrence-rule='rule-a']").click()
    page.get_by_role("button", name="课程详情", exact=True).click()
    expect(page.locator("#detail-title")).to_have_text("日本美术史")
    expect(page.locator("#study-dialog")).not_to_be_visible()
    assert not errors, errors
    context.close()


def test_backup_course_safety(browser):
    context, page, errors = context_page(browser, 1440, 1000)
    load_fixture(page)
    nav(page, "settings")
    upload(page, {"version": 2, "exportedAt": STAMP, "theme": "sage", "glass": True, "items": [], "courses": []})
    expect(page.locator("#confirm-message")).to_contain_text("不含学期和排课")
    page.locator("#confirm-accept").click(); expect(page.locator("#confirm-dialog")).not_to_be_visible()
    page.locator("#restore-recovery").click(); page.locator("#confirm-accept").click()
    expect(page.locator("#confirm-dialog")).not_to_be_visible()
    result = export_data(page)
    assert len(result["terms"]) == 1 and len(result["recurrenceRules"]) == 3
    bad = fixture(); bad["courses"] = []
    upload(page, bad)
    expect(page.locator("#toast-message")).to_contain_text("缺少对应")
    assert len(export_data(page)["courses"]) == 2
    plan_courses(page)
    page.locator("#user-course-list .record-open").filter(has_text="日本美术史").click()
    page.locator("[data-course-note]").click(); page.locator("#quick-entry").fill("删除课程后仍保留的笔记")
    page.locator("#save-entry").click(); expect(page.locator("#compose-layer")).not_to_be_visible()
    page.get_by_role("button", name="删除", exact=True).click()
    nav(page, "notes"); page.get_by_role("searchbox").fill("删除课程后")
    page.locator("#notes-list .record-open").click()
    expect(page.locator("#entry-detail")).to_contain_text("关联课程已移除")
    nav(page, "settings"); page.locator("#trash-list [data-entity='course']").click()
    plan_courses(page)
    expect(page.locator(".timetable-class[data-occurrence-rule='rule-a']")).to_be_visible()
    assert not errors, errors
    context.close()


def assert_indicator(page):
    page.wait_for_function("""() => {
      const indicator = document.querySelector('.segmented__selection').getBoundingClientRect();
      const selected = document.querySelector('.segmented [aria-selected="true"]').getBoundingClientRect();
      return Math.abs(indicator.x - selected.x) < 1 && Math.abs(indicator.width - selected.width) < 1;
    }""")


def settle(page):
    page.evaluate("async () => await document.fonts.ready")
    page.wait_for_function("() => !document.querySelector('#toast').classList.contains('is-showing')")
    page.wait_for_function("() => document.getAnimations().every(animation => animation.playState !== 'running')")


def test_segmented_layouts(browser):
    for width, height, color, scale in [(320, 568, "light", 100), (390, 844, "dark", 100), (768, 1024, "light", 100), (1440, 1000, "dark", 100), (667, 375, "dark", 100), (390, 844, "dark", 200)]:
        context, page, errors = context_page(browser, width, height, color_scheme=color, reduced_motion="reduce" if scale == 200 else "no-preference")
        load_fixture(page)
        if scale != 100:
            page.add_style_tag(content=f"html {{ font-size: {scale}% !important; }}")
        assert_width(page); assert_indicator(page)
        buttons = page.locator(".segmented [role='tab']")
        dimensions = buttons.evaluate_all("nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return [r.width, r.height]; })")
        assert max(item[0] for item in dimensions) - min(item[0] for item in dimensions) < 1
        assert min(item[1] for item in dimensions) >= 44
        page.get_by_role("tab", name="待办", exact=True).click()
        page.get_by_role("tab", name="本周", exact=True).click()
        page.get_by_role("tab", name="课程表", exact=True).click()
        assert_indicator(page)
        page.locator("#tab-courses").focus(); page.keyboard.press("ArrowLeft")
        expect(page.locator("#tab-tasks")).to_be_focused()
        expect(page.locator("#tab-tasks")).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Home"); expect(page.locator("#tab-week")).to_be_focused()
        page.keyboard.press("End"); expect(page.locator("#tab-courses")).to_be_focused()
        assert_indicator(page)
        # Capture the ordinary pointer state after separately verifying the keyboard focus ring.
        page.get_by_role("tab", name="待办", exact=True).click()
        page.get_by_role("tab", name="课程表", exact=True).click()
        assert_indicator(page)
        name = f"timetable-{width}-{color}-{scale}"
        settle(page)
        page.screenshot(path=str(OUTPUT / f"{name}.png"), full_page=True)
        if width >= 768:
            # Overlapping classes occupy separate horizontal lanes instead of concealing each other.
            a = page.locator(".timetable-class[data-occurrence-rule='rule-a']").bounding_box()
            b = page.locator(".timetable-class[data-occurrence-rule='rule-c']").bounding_box()
            assert a["x"] + a["width"] <= b["x"] + 1
        page.get_by_role("button", name="新建学期", exact=True).click()
        assert_width(page)
        button = page.locator("#study-save").bounding_box()
        assert button["y"] >= 0 and button["y"] + button["height"] <= height
        settle(page)
        if scale == 200:
            assert page.locator("#study-start").bounding_box()["width"] >= 300
        page.screenshot(path=str(OUTPUT / f"{name}-form.png"), full_page=False)
        page.get_by_role("button", name="关闭课程设置", exact=True).click()
        expect(page.locator("#study-dialog")).not_to_be_visible()
        assert not errors, errors
        context.close()


def test_unsaved_and_offline(browser):
    context, page, errors = context_page(browser, 390, 844)
    load_fixture(page)
    page.get_by_role("button", name="新建学期", exact=True).click()
    page.locator("#study-name").fill("保留输入")
    page.get_by_role("button", name="关闭课程设置", exact=True).click()
    expect(page.locator("#confirm-dialog")).to_be_visible()
    page.locator("#confirm-cancel").click()
    expect(page.locator("#study-name")).to_have_value("保留输入")
    page.go_back()
    expect(page.locator("#confirm-dialog")).to_be_visible()
    page.locator("#confirm-accept").click()
    expect(page.locator("#study-dialog")).not_to_be_visible()
    expect(page.locator("#view-plan")).to_be_visible()
    page.evaluate("async () => await navigator.serviceWorker.ready")
    context.set_offline(True)
    page.reload(); ready(page)
    expect(page.locator(".course-day-list")).to_contain_text("日本美术史")
    page.locator(".course-day-list [data-occurrence-rule='rule-a']").click()
    page.locator("#study-adjustment").select_option("cancelled")
    study_save(page)
    page.reload(); ready(page)
    expect(page.locator(".course-day-list [data-occurrence-rule='rule-a']")).to_contain_text("已停课")
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for test in [test_build_schedule, test_single_class_adjustment, test_backup_course_safety, test_segmented_layouts, test_unsaved_and_offline]:
            test(browser)
            print(f"PASS {test.__name__}", flush=True)
        browser.close()
    print("v0.6 timetable UI acceptance passed")
