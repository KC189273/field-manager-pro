"""
Take screenshots of phone mockups from HTML files.
Captures the .phone element from each .screen-wrap div.
"""
import asyncio
import os
from playwright.async_api import async_playwright

BASE_DIR = "/Users/shaungephart/Desktop/Claude Projects/field-manager-pro"
OUTPUT_DIR = os.path.join(BASE_DIR, "mockup_screens")

# Main mockup screens
MAIN_SCREENS = [
    ("screen_clock.png",    0),  # Clock In/Out
    ("screen_menu.png",     1),  # Navigation Menu
    ("screen_map.png",      2),  # Map
    ("screen_expenses.png", 3),  # Expenses
    ("screen_schedule.png", 4),  # Schedule
]

# Extra screens
EXTRA_SCREENS = [
    ("screen_tasks.png",     0),  # Tasks
    ("screen_timecards.png", 1),  # Timecards
    ("screen_team.png",      2),  # Team
    ("screen_flags.png",     3),  # Flags
    ("screen_login.png",     4),  # Login
]

async def screenshot_phones(page, html_path, screens):
    await page.goto(f"file://{html_path}")
    await page.wait_for_load_state("networkidle")

    # Get all screen-wrap elements
    wraps = await page.query_selector_all(".screen-wrap")
    print(f"  Found {len(wraps)} screen-wrap(s) in {os.path.basename(html_path)}")

    for filename, idx in screens:
        if idx >= len(wraps):
            print(f"  [SKIP] Index {idx} out of range for {filename}")
            continue
        wrap = wraps[idx]
        phone = await wrap.query_selector(".phone")
        if not phone:
            print(f"  [SKIP] No .phone found for index {idx} ({filename})")
            continue
        out_path = os.path.join(OUTPUT_DIR, filename)
        await phone.screenshot(path=out_path)
        print(f"  Saved: {filename}")

async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await context.new_page()

        print("--- Main mockup.html ---")
        await screenshot_phones(
            page,
            os.path.join(BASE_DIR, "mockup.html"),
            MAIN_SCREENS
        )

        print("--- Extra mockup_screens_extra.html ---")
        await screenshot_phones(
            page,
            os.path.join(BASE_DIR, "mockup_screens_extra.html"),
            EXTRA_SCREENS
        )

        await browser.close()

    print("\nDone. Screenshots saved to:", OUTPUT_DIR)
    for f in sorted(os.listdir(OUTPUT_DIR)):
        fpath = os.path.join(OUTPUT_DIR, f)
        print(f"  {f}  ({os.path.getsize(fpath):,} bytes)")

if __name__ == "__main__":
    asyncio.run(main())
