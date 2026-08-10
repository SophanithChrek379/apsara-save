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

test('fixed deposit tab toggles an installment and updates the tally', async ({ page }) => {
  await page.goto('/savings');

  const fdTab = page.getByRole('tab', { name: /fixed deposit/i });
  await fdTab.click();
  await expect(fdTab).toHaveAttribute('aria-selected', 'true');

  // The first installment (Jan 3, 2026) is always due by the time this test
  // can run, so it's a stable target unlike "the current month" — the whole
  // deposit isn't calendar-year-scoped.
  const row = page.getByRole('button', { name: /^Jan 3, 2026 — \$100\.00/ });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-pressed', 'false');

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 / 12 installments')).toBeVisible();

  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('0 / 12 installments')).toBeVisible();
});
