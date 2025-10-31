
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # 1. Navigate to the Policy page
            await page.goto("http://localhost:8000/policies")

            # 2. Wait for Tom-select to be initialized and select a device
            await page.wait_for_selector('.ts-wrapper', state='visible', timeout=15000)
            await page.click('.ts-control')
            await page.click('.ts-dropdown [data-value="1"]')

            # 3. Click the search button to load data
            await page.click('#btn-search')

            # 4. Wait for the grid to be visible and populated
            grid_selector = "#policies-grid .ag-root-wrapper"
            await page.wait_for_selector(grid_selector, state="visible", timeout=15000)

            # Wait for rows to appear, indicating data has loaded
            await page.wait_for_selector(".ag-row", state="visible", timeout=15000)

            # Give a brief moment for final rendering/styling
            await page.wait_for_timeout(2000)

            # 5. Take a screenshot of the grid area
            grid_element = await page.query_selector(grid_selector)
            if grid_element:
                await grid_element.screenshot(path="jules-scratch/verification/verification.png")
            else:
                await page.screenshot(path="jules-scratch/verification/verification.png")

        except Exception as e:
            print(f"An error occurred: {e}")
            await page.screenshot(path="jules-scratch/verification/error.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
