
import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # 1. Dashboard Loading Verification
            print("Navigating to Dashboard...")
            await page.goto("http://localhost:8000/dashboard", wait_until="networkidle")
            await expect(page.get_by_role("heading", name="대시보드")).to_be_visible(timeout=15000)
            print("Dashboard loaded successfully.")

            # 2. Policy Page and Grid Verification
            print("Navigating to Policy page...")
            await page.get_by_role("link", name="정책 조회").click()
            await page.wait_for_url("**/policies", wait_until="networkidle")
            await expect(page.get_by_role("heading", name="정책 조회")).to_be_visible()

            # Wait for the grid to be ready
            print("Waiting for policy grid to be ready...")
            await page.wait_for_selector(".ag-root-wrapper", timeout=15000)
            print("Policy grid loaded.")

            # Perform a combined search to populate the grid with specific data
            print("Performing combined search for '1.1.1.1' and 'tcp/443'...")
            await page.locator('input[name="src_ips"]').fill("1.1.1.1")
            await page.locator('input[name="services"]').fill("tcp/443")
            await page.get_by_role("button", name="검색").click()

            # Wait for the search results to load and network to be idle
            await page.wait_for_load_state('networkidle')
            await page.wait_for_function("document.querySelector('.ag-row-level-0')")
            print("Search results are visible.")

            # Take a screenshot of the policy grid with multi-line cells
            await page.screenshot(path="jules-scratch/verification/policy_grid_verification.png")
            print("Screenshot of policy grid taken successfully.")

            # 3. Object Detail Modal Verification
            print("Testing object detail modal...")
            row_locator = page.locator('.ag-row:has-text("Test-Search-Rule-Direct-HTTPS")')
            link_locator = row_locator.locator('[col-id="destination"]').get_by_role("link", name="Test-Host-1")

            await expect(link_locator).to_be_visible(timeout=5000)
            print("Link 'Test-Host-1' found. Clicking...")
            await link_locator.click()

            # Wait for the modal to appear and verify its title
            print("Waiting for modal to appear...")
            await expect(page.locator(".modal.is-active")).to_be_visible(timeout=10000)
            await expect(page.get_by_role("heading", name="객체 상세 정보: Test-Host-1")).to_be_visible()
            print("Object detail modal opened successfully.")

            # Take a screenshot of the modal
            await page.screenshot(path="jules-scratch/verification/object_modal_verification.png")
            print("Screenshot of object modal taken successfully.")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            await page.screenshot(path="jules-scratch/verification/error_screenshot.png")
            print("Error screenshot saved to jules-scratch/verification/error_screenshot.png")

        finally:
            await browser.close()
            print("Verification script finished.")

if __name__ == "__main__":
    asyncio.run(main())
