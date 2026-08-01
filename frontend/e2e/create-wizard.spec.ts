import { test, expect, type Page } from '@playwright/test'

async function openWizard(page: Page) {
  await page.goto('/')
  await page.getByTestId('open-create-wizard').click()
  await expect(page.getByTestId('create-stream-wizard')).toBeVisible()
}

test.describe('Create-stream wizard', () => {
  test('step 1 – progress indicator shows step 1 active', async ({ page }) => {
    await openWizard(page)
    const firstStep = page.locator('[aria-current="step"]')
    await expect(firstStep).toBeVisible()
    await expect(firstStep).toContainText('1')
  })

  test('step 1 – recipient input validation on blur', async ({ page }) => {
    await openWizard(page)
    const input = page.getByTestId('wizard-recipient')
    await input.fill('invalid')
    await input.blur()
    await expect(page.getByTestId('recipient-error')).toBeVisible()
  })

  test('step 2 – select USDC preset button exists', async ({ page }) => {
    await openWizard(page)
    await page.goto('/#token')
    await expect(page.getByTestId('wizard-token-usdc')).toBeVisible()
  })

  test('step 3 – schedule input with deposit preview', async ({ page }) => {
    await page.goto('/#schedule')
    const rateInput = page.getByTestId('wizard-rate')
    await expect(rateInput).toBeVisible()
  })

  test('step 4 – review heading visible', async ({ page }) => {
    await page.goto('/#review')
    await expect(page.getByRole('heading', { name: /review stream/i })).toBeVisible()
  })

  test('wizard can be closed via close button', async ({ page }) => {
    await openWizard(page)
    await page.getByRole('button', { name: /close wizard/i }).click()
    await expect(page.getByTestId('create-stream-wizard')).not.toBeVisible()
  })

  test('wizard can be closed by clicking the backdrop', async ({ page }) => {
    await openWizard(page)
    await page.getByTestId('create-stream-wizard').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('create-stream-wizard')).not.toBeVisible()
  })

  test('progress indicator shows all 4 step labels', async ({ page }) => {
    await openWizard(page)
    const nav = page.getByRole('navigation', { name: /wizard progress/i })
    await expect(nav).toBeVisible()
    for (const label of ['Recipient', 'Token', 'Schedule', 'Review']) {
      await expect(nav).toContainText(label)
    }
  })

  test('URL hash deep-links to step', async ({ page }) => {
    await page.goto('/#token')
    await expect(page.getByTestId('wizard-token-custom')).toBeVisible()
    await page.goto('/#schedule')
    await expect(page.getByTestId('wizard-rate')).toBeVisible()
    await page.goto('/#review')
    await expect(page.getByRole('heading', { name: /review stream/i })).toBeVisible()
  })
})
