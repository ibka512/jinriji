"""v1.0 RC: local isolated Chromium/WebKit; not a real-device Safari claim."""
import json
import os
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import BASE_URL, OUTPUT, context_page, nav, ready, save, assert_width, test_backup
from maturity_acceptance import record, payload, import_fixture, test_course_creation_flow
from library_acceptance import test_image_table_backup
from writing_acceptance import more

ENGINE = os.getenv("JINRIJI_TEST_ENGINE", "chromium")
assert ENGINE in ("chromium", "webkit")

ACCESSIBILITY_AUDIT = """() => {
  const rendered = element => {
    const style=getComputedStyle(element), rect=element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden &&
      !element.closest('[hidden],[inert]') && rect.width > 0 && rect.height > 0;
  };
  const name = element => element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.labels?.[0]?.textContent?.trim() || element.textContent?.trim() || element.getAttribute('placeholder') || '';
  const selector='button,a[href],input:not([type="hidden"]),select,textarea,summary,[contenteditable="true"]';
  const controls=[...document.querySelectorAll(selector)].filter(rendered);
  const identify = element => ({
    tag:element.tagName.toLowerCase(), id:element.id, name:name(element).replace(/\\s+/g,' ').slice(0,80),
    width:Math.round(element.getBoundingClientRect().width*10)/10,
    height:Math.round(element.getBoundingClientRect().height*10)/10
  });
  return {
    unnamed:controls.filter(element => !name(element)).map(identify),
    undersized:controls.filter(element => ['BUTTON','A','SUMMARY'].includes(element.tagName) &&
      (element.getBoundingClientRect().width < 44 || element.getBoundingClientRect().height < 44)).map(identify)
  };
}"""


def assert_accessible_surface(page):
    result=page.evaluate(ACCESSIBILITY_AUDIT)
    assert not result["unnamed"], result
    assert not result["undersized"], result


def test_accessibility_contract(browser):
    for width,height in ((320,700),(1440,1000)):
        context,page,errors=context_page(browser,width,height,reduced_motion="reduce")
        # Startup already places focus on the active page heading. Exercise the
        # bypass link explicitly instead of assuming the browser starts at body.
        page.locator(".skip-link").focus()
        expect(page.locator(".skip-link")).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.locator("#main-content")).to_be_focused()
        assert_accessible_surface(page)

        nav(page,"settings")
        selected=page.get_by_role("radio",name="苔庭"); selected.focus(); page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio",name="樱雨")).to_be_focused()
        expect(page.get_by_role("radio",name="樱雨")).to_have_attribute("aria-checked","true")
        assert_accessible_surface(page)

        nav(page,"plan")
        week=page.get_by_role("tab",name="本周",exact=True); week.focus(); page.keyboard.press("ArrowRight")
        expect(page.get_by_role("tab",name="待办",exact=True)).to_be_focused()
        expect(page.get_by_role("tab",name="待办",exact=True)).to_have_attribute("aria-selected","true")
        assert_accessible_surface(page)

        page.goto(f"{BASE_URL.rstrip('/')}#notes/new/a11y-{ENGINE}-{width}")
        ready(page); expect(page.locator("#note-editor-page")).to_be_visible()
        page.locator(".writer-more > summary").click()
        assert_accessible_surface(page)
        expect(page.get_by_role("textbox",name="便签正文")).to_be_visible()
        expect(page.get_by_role("button",name="衬线正文")).to_have_attribute("aria-pressed","false")
        page.screenshot(path=str(OUTPUT / f"release-{ENGINE}-a11y-{width}.png"),full_page=True)
        assert not errors, errors; context.close()


def task_fixture(page):
    import_fixture(page, payload([{**record(str(i), f"行动 {i}"), "kind": "task"} for i in range(3)]))
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()


def test_keyboard_and_completion(browser):
    context, page, errors = context_page(browser, 390, 844)
    task_fixture(page)
    first = page.locator('#user-task-list [data-entry-check="0"]')
    first.focus(); first.press("Space")
    expect(page.locator('#user-task-list [data-entry-check="1"]')).to_be_focused()
    expect(page.locator("#toast-message")).to_have_text("已完成")
    expect(page.locator("#toast-message")).to_have_attribute("role", "status")
    expect(page.locator("#toast-dismiss")).to_be_visible()
    toast_tree=page.locator("#toast").aria_snapshot()
    assert "status: 已完成" in toast_tree and 'button "撤销"' in toast_tree and 'button "关闭提示"' in toast_tree, toast_tree
    # Real keyboard navigation must not animate the whole view or dock.
    page.keyboard.press("Tab")  # existing shortcuts deliberately ignore input controls
    page.keyboard.press("Alt+Digit4")
    expect(page.locator("#view-settings")).to_be_visible()
    assert page.locator("#view-settings").evaluate("e => getComputedStyle(e).transitionDuration") == "0s"
    assert page.locator(".mobile-nav__selection").evaluate("e => getComputedStyle(e).transitionDuration") == "0s"
    # Focused notification remains operable past timeout, explicit close returns focus.
    page.locator("#toast-action").focus(); page.clock.run_for(9000)
    expect(page.locator("#toast")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#toast")).to_be_hidden()
    assert not page.locator("#toast").evaluate("e => e.contains(document.activeElement)")
    assert page.locator("#toast").evaluate("e => e.inert")
    assert not errors, errors; context.close()


def test_menu_and_modal_lifecycle(browser):
    context, page, errors = context_page(browser, 390, 844)
    nav(page, "notes")
    menu = page.locator(".organization-filters .disclosure-menu")
    summary = menu.locator("summary")
    summary.click(); expect(menu).to_have_attribute("open", "")
    page.locator("#record-sort").focus(); page.keyboard.press("Escape")
    expect(menu).not_to_have_attribute("open", "")
    expect(summary).to_be_focused()
    for _ in range(4):
        summary.click(); summary.click()
    expect(menu).not_to_have_attribute("open", "")
    summary.click(); page.locator("#record-sort").focus()
    page.locator("#search-records").focus()
    expect(menu).not_to_have_attribute("open", "")
    expect(menu.locator(".disclosure-panel")).to_have_js_property("inert", True)
    nav(page, "plan"); page.get_by_role("tab", name="待办", exact=True).click()
    for _ in range(3):
        page.locator(".mobile-quick-add").click()
        expect(page.locator("#compose-layer")).to_be_visible()
        page.get_by_role("button", name="关闭编辑器").click()
        expect(page.locator("#compose-layer")).not_to_be_visible()
        page.wait_for_function("() => !history.state?.jinrijiModal")
    page.emulate_media(reduced_motion="reduce")
    page.locator(".mobile-quick-add").click()
    assert page.locator("#compose-layer").evaluate("e => getComputedStyle(e).transform") == "none"
    page.get_by_role("button", name="关闭编辑器").click()
    assert not errors, errors; context.close()


CONTRAST = """() => {
  const style=getComputedStyle(document.documentElement), c=document.createElement('canvas'); c.width=c.height=1;
  const ctx=c.getContext('2d');
  const rgb = token => {ctx.clearRect(0,0,1,1);ctx.fillStyle=style.getPropertyValue(token).trim();ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
  const l = rgb => rgb.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=> {const x=l(rgb(a)), y=l(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  return {ink:ratio('--ink','--paper-solid'),secondary:ratio('--ink-soft','--paper-solid'),action:ratio('--on-action','--action-bg')};
}"""


def test_theme_and_touch_states(browser):
    metrics=[]
    for scheme in ("light", "dark"):
        context, page, errors = context_page(browser, 390, 844, color_scheme=scheme, has_touch=True, is_mobile=True)
        nav(page, "settings")
        for theme in ("sage", "sakura", "aizome", "kaki"):
            page.locator(f'[data-theme="{theme}"]').click()
            expect(page.locator(f'[data-theme="{theme}"]')).to_have_attribute("aria-checked", "true")
            result=page.evaluate(CONTRAST); metrics.append(dict(scheme=scheme,theme=theme,**result))
            assert min(result.values()) >= 4.5, result
        page.screenshot(path=str(OUTPUT / f"release-{ENGINE}-settings-{scheme}.png"), full_page=True)
        assert_width(page); assert not errors, errors; context.close()
    print("CONTRAST " + json.dumps(metrics), flush=True)
    if ENGINE == "chromium":
        context, page, errors = context_page(browser, 390, 844, forced_colors="active")
        nav(page, "settings"); theme = page.get_by_role("radio", name="苔庭")
        forced = page.evaluate("""() => ({
          border:getComputedStyle(document.querySelector('.glass')).borderStyle,
          shadow:getComputedStyle(document.querySelector('.glass')).boxShadow,
          selected:getComputedStyle(document.querySelector('[data-theme="sage"]')).outlineStyle
        })""")
        assert forced == {"border":"solid", "shadow":"none", "selected":"solid"}, forced
        page.screenshot(path=str(OUTPUT / "release-chromium-forced-colors.png"))
        assert not errors, errors; context.close()


def test_large_type_writer(browser):
    for width,height in ((320,700),(768,1024)):
        context, page, errors = context_page(browser, width, height, color_scheme="dark")
        import_fixture(page,payload([record("long", "长文与工具栏", "可继续书写的一段文字。\n"*180)]))
        nav(page,"notes"); page.locator('#notes-list [data-entry-open="long"]').click()
        page.get_by_role("button",name="编辑",exact=True).click()
        expect(page.locator("#note-editor-page")).to_be_visible()
        page.evaluate("document.documentElement.style.fontSize='200%'")
        page.evaluate("window.scrollTo(0,600)")
        page.wait_for_function("() => {const a=document.querySelector('.note-editor-page .compose-head').getBoundingClientRect(),b=document.querySelector('.writer-chrome').getBoundingClientRect();return b.top>=a.bottom-1;}")
        assert_width(page)
        more(page); panel=page.locator(".writer-tools")
        assert panel.bounding_box()["height"] <= height*.49
        page.screenshot(path=str(OUTPUT / f"release-{ENGINE}-writer-{width}-200.png"))
        page.keyboard.press("Escape"); save(page)
        page.reload(); ready(page); expect(page.locator("#detail-title")).to_have_text("长文与工具栏")
        assert not errors, errors; context.close()


if __name__ == "__main__":
    if ENGINE == "webkit":
        # Playwright WebKit 1.55 on macOS raises an internal automation error on
        # offline reload even for a constant-response minimal worker. Keep the
        # layout/data lane; Chromium executes the real offline worker lane.
        os.environ["JINRIJI_SKIP_OFFLINE"] = "1"
    with sync_playwright() as p:
        browser=getattr(p,ENGINE).launch(headless=True)
        for test in [test_accessibility_contract,test_keyboard_and_completion,test_menu_and_modal_lifecycle,test_theme_and_touch_states,
                     test_large_type_writer,test_backup,test_image_table_backup,test_course_creation_flow]:
            test(browser); print(f"PASS {ENGINE} {test.__name__}",flush=True)
        browser.close()
    print(f"Release acceptance passed: {ENGINE}")
