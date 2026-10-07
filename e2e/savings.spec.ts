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

  const monthlyTab = page.getByRole('tab', { name: /monthly/i });
  await monthlyTab.click();
  await expect(monthlyTab).toHaveAttribute('aria-selected', 'true');

  const cashTab = page.getByRole('tab', { name: /cash book/i });
  await cashTab.click();
  await expect(cashTab).toHaveAttribute('aria-selected', 'true');
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

  // Un-toggling corrects a mistaken entry, same as the Daily tab.
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('0 / 12 months')).toBeVisible();
});

test('monthly tab skip action removes the payday trigger and can be undone', async ({ page }) => {
  await page.goto('/savings');

  const monthlyTab = page.getByRole('tab', { name: /monthly/i });
  await monthlyTab.click();
  await expect(monthlyTab).toHaveAttribute('aria-selected', 'true');

  const injectButton = page.getByRole('button', { name: /^Inject the .* payday allocation/i });
  await expect(injectButton).toBeVisible();

  const skipButton = page.getByRole('button', { name: /^Skip the .* monthly allocation/i });
  await skipButton.click();

  await expect(injectButton).not.toBeVisible();
  await expect(skipButton).not.toBeVisible();
  await expect(page.getByText(/skipped — its target isn't counted against the year/i)).toBeVisible();

  // A skipped month can no longer take a per-bucket deposit until undone.
  const fundButton = page
    .getByRole('tabpanel')
    .getByRole('button', { name: /^Mark .* funded for/i })
    .first();
  await expect(fundButton).toBeDisabled();

  const undoButton = page.getByRole('button', { name: /^Undo skip for/i });
  await undoButton.click();

  await expect(injectButton).toBeVisible();
  await expect(skipButton).toBeVisible();
  await expect(fundButton).toBeEnabled();
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

test('salary tab stays locked until Face ID, then takes and hides a salary', async ({ page, context }) => {
  // Chromium's virtual authenticator stands in for Face ID: a built-in
  // ("internal") authenticator that always verifies the user. The figure is a
  // made-up one so no real salary is ever committed alongside the tests.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/savings');
  const salaryTab = page.getByRole('tab', { name: /salary/i });
  await salaryTab.click();
  await expect(salaryTab).toHaveAttribute('aria-selected', 'true');

  // Locked: placeholders only, and nothing salary-shaped in the panel.
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Locked')).toBeVisible();
  await panel.getByRole('button', { name: /set up face id to view/i }).click();

  // First unlock with nothing on file opens the entry form directly.
  await panel.getByRole('textbox').fill('12,000');
  await panel.getByRole('button', { name: /^save \d{4}$/i }).click();
  await expect(panel.getByText('$12,000.00', { exact: true })).toBeVisible();
  await expect(panel.getByText('Savings vs Salary')).toBeVisible();

  // Locking drops the figure out of the DOM, not just out of sight.
  await panel.getByRole('button', { name: 'Lock salary' }).click();
  await expect(panel.getByText('$12,000.00', { exact: true })).toHaveCount(0);

  // A second unlock uses the registered passkey and reads the stored figure.
  await panel.getByRole('button', { name: /unlock with face id/i }).click();
  await expect(panel.getByText('$12,000.00', { exact: true })).toBeVisible();

  // Leaving the tab unmounts it, so coming back asks again.
  await page.getByRole('tab', { name: /daily/i }).click();
  await salaryTab.click();
  await expect(page.getByRole('tabpanel').getByText('Locked')).toBeVisible();
});
