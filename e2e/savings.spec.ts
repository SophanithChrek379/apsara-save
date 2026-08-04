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
