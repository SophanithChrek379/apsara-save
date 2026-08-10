import { test, expect } from '@playwright/test';

test('redirects / to /savings', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/savings$/);
});

test('savings page loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/savings');
  await expect(page.getByRole('tab', { name: /daily/i })).toBeVisible();

  expect(errors).toEqual([]);
});

test('switching strategy tabs updates aria-selected and content', async ({ page }) => {
  await page.goto('/savings');

  const weeklyTab = page.getByRole('tab', { name: /weekly/i });
  await weeklyTab.click();
  await expect(weeklyTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/weekly escalation ladder/i)).toBeVisible();

  const monthlyTab = page.getByRole('tab', { name: /monthly/i });
  await monthlyTab.click();
  await expect(monthlyTab).toHaveAttribute('aria-selected', 'true');
});

test('progress bars expose full ARIA value range', async ({ page }) => {
  await page.goto('/savings');

  const bar = page.getByRole('progressbar').first();
  await expect(bar).toHaveAttribute('aria-valuemin');
  await expect(bar).toHaveAttribute('aria-valuemax');
  await expect(bar).toHaveAttribute('aria-valuenow');
  await expect(bar).toHaveAttribute('aria-label');
});

test('cash book tab toggles the current month and updates the tally', async ({ page }) => {
  await page.goto('/savings');

  const cashTab = page.getByRole('tab', { name: /cash book/i });
  await cashTab.click();
  await expect(cashTab).toHaveAttribute('aria-selected', 'true');

  const monthName = new Date().toLocaleString('en-US', { month: 'long' });
  const row = page.getByRole('button', { name: new RegExp(`^${monthName} — \\$100\\.00`) });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-pressed', 'false');

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 / 12 months')).toBeVisible();

  // Un-toggling corrects a mistaken entry, same as the Daily and Weekly tabs.
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('0 / 12 months')).toBeVisible();
});

test('fixed deposit tab shows a read-only preview with no controls', async ({ page }) => {
  await page.goto('/savings');

  const fdTab = page.getByRole('tab', { name: /fixed deposit/i });
  await fdTab.click();
  await expect(fdTab).toHaveAttribute('aria-selected', 'true');

  // The deposit was already made in full on the start date, so this tab is a
  // preview, not a checklist — there is nothing on it to click.
  await expect(page.getByText('ABA Fixed Deposit')).toBeVisible();
  await expect(page.getByText('$100.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /fixed deposit term progress/i })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('button')).toHaveCount(0);
});
