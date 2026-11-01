// The ladder in a real browser. Each test starts from a reset session (POST /api/reset, the same route the Reset button uses).
// Console errors fail a test, except the deliberate 4xx answers the server gives for refused actions.
import { test, expect } from '@playwright/test';

const DELIBERATE_4XX = /status of 4\d\d/;

test.beforeEach(async ({ page, request }, testInfo) => {
  const r = await request.post('/api/reset', { data: {} });
  expect(r.status()).toBe(200);
  testInfo.annotations.push({ type: 'console', description: 'collected' });
  page.consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !DELIBERATE_4XX.test(m.text())) page.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => page.consoleErrors.push(String(e)));
});
test.afterEach(async ({ page }) => {
  expect(page.consoleErrors, 'console errors').toEqual([]);
});

const status = (page) => page.getByRole('status');
const rungHeading = (page, name) => page.getByRole('heading', { name: `Your rung: ${name}` });

test('the ladder climbs 0 to 3 in the browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/MOCK\. Simulated\. No bank, no PingOne tenant/)).toBeVisible();
  await expect(rungHeading(page, 'Public')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(rungHeading(page, 'Signed in')).toBeVisible();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await expect(rungHeading(page, 'Step-up satisfied')).toBeVisible();
  await page.getByLabel(/Amount/).fill('800');
  await page.getByRole('button', { name: 'Ask phone to approve' }).click();
  await page.getByRole('button', { name: 'Approve on phone' }).click();
  await expect(rungHeading(page, 'CIBA approved')).toBeVisible({ timeout: 20_000 });
});

test('a payment above 600 is refused at rung 2 and allowed once the phone approves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await page.getByLabel(/Amount/).fill('800');
  await page.getByRole('button', { name: 'Send payment' }).click();
  await expect(status(page)).toHaveText(/Payment: Not enough trust for this payment yet\. Rung 2\./);
  await page.getByRole('button', { name: 'Ask phone to approve' }).click();
  await page.getByRole('button', { name: 'Approve on phone' }).click();
  await expect(page.getByText('No requests waiting.')).toBeVisible();
  await expect(rungHeading(page, 'CIBA approved')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Send payment' }).click();
  await expect(status(page)).toHaveText(/Payment: done\. Rung 2 \(Step-up satisfied\)\./);
});

test('the phone deny path refuses the payment and keeps rung 2', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await page.getByLabel(/Amount/).fill('900');
  await page.getByRole('button', { name: 'Ask phone to approve' }).click();
  await page.getByRole('button', { name: 'Deny on phone' }).click();
  // The status line changes by itself: the page's tick picks up the denial within a few seconds, with no click.
  await expect(status(page)).toHaveText(/The phone denied the request\. The payment stays refused\./, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Send payment' }).click();
  await expect(status(page)).toHaveText(/The phone denied the request\. Rung 2\./);
  await expect(rungHeading(page, 'Step-up satisfied')).toBeVisible();
});

test('a step down needs a reason and is recorded in the history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await page.getByLabel('Step down to').selectOption('1');
  await page.getByRole('button', { name: 'Step down' }).click();
  await expect(status(page)).toHaveText(/Step down: a reason is required to step down\./);
  await page.getByLabel('Reason (required)').fill('customer asked to step down');
  await page.getByRole('button', { name: 'Step down' }).click();
  await expect(rungHeading(page, 'Signed in')).toBeVisible();
  await expect(page.getByRole('list').filter({ has: page.getByText('customer asked to step down') })).toContainText('explicit');
});

test('a risk score that rises refuses a payment that the amount alone would allow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await page.locator('#risk').fill('96');
  await expect(page.getByTestId('risk-value')).toHaveText('96');
  await page.getByLabel(/Amount/).fill('100');
  await page.getByRole('button', { name: 'Send payment' }).click();
  await expect(status(page)).toHaveText(/Payment: Not enough trust for this payment yet\. Rung 2\./);
  await page.locator('#risk').fill('0');
  await expect(rungHeading(page, 'Step-up satisfied')).toBeVisible();
});

test('keyboard only: sign-in works with Tab and Enter', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('Tab'); // Sign in
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rungHeading(page, 'Signed in')).toBeVisible();
});

test('the page has no horizontal scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(rungHeading(page, 'Public')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${test.info().outputDir}/mobile-375.png`, fullPage: true });
});

for (const scheme of ['light', 'dark']) {
  test(`the page renders in ${scheme} mode with a readable banner`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const banner = page.locator('.banner');
    await expect(banner).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `${test.info().outputDir}/${scheme}.png`, fullPage: true });
  });
}

test('the diagram walks its steps and Reset restores positions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByTestId('caption')).toContainText('Step 1 of 5');
  await page.getByRole('button', { name: 'Reset diagram' }).click();
  await expect(page.getByTestId('caption')).toHaveText('');
});

test('the Reset button clears the rung and the history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Step-up check' }).click();
  await expect(rungHeading(page, 'Step-up satisfied')).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(rungHeading(page, 'Public')).toBeVisible();
  await expect(page.getByText('No changes yet.')).toBeVisible();
});

test('the page Reset button also puts a dragged diagram box back', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: 'Personal agent' }).first();
  await expect(node).toBeVisible();
  await node.scrollIntoViewIfNeeded();
  // Positions are measured inside the diagram canvas, because pressing Reset scrolls the page back to the top.
  const inCanvas = async () => {
    const [n, c] = [await node.boundingBox(), await page.locator('.diagram').boundingBox()];
    return { x: n.x - c.x, y: n.y - c.y, w: n.width, h: n.height };
  };
  const before = await inCanvas();
  const sx = before.x + before.w / 2 + (await page.locator('.diagram').boundingBox()).x;
  const sy = before.y + 12 + (await page.locator('.diagram').boundingBox()).y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 4 });
  await page.mouse.move(sx + 120, sy + 100, { steps: 20 });
  await page.mouse.up();
  const moved = await inCanvas();
  expect(Math.abs(moved.x - before.x) + Math.abs(moved.y - before.y)).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(async () => {
    const b = await inCanvas();
    return Math.abs(b.x - before.x) + Math.abs(b.y - before.y);
  }).toBeLessThan(4);
});

test('a dragged diagram box goes back to its place on Reset diagram', async ({ page }) => {
  await page.goto('/');
  const node = page.locator('.react-flow__node').filter({ hasText: 'Personal agent' }).first();
  await expect(node).toBeVisible();
  await node.scrollIntoViewIfNeeded();
  const before = await node.boundingBox();
  const sx = before.x + before.width / 2;
  const sy = before.y + 12;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 4 }); // past the drag threshold
  await page.mouse.move(sx + 120, sy + 100, { steps: 20 });
  await page.mouse.up();
  const moved = await node.boundingBox();
  expect(Math.abs(moved.x - before.x) + Math.abs(moved.y - before.y)).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Reset diagram' }).click();
  await expect.poll(async () => {
    const b = await node.boundingBox();
    return Math.abs(b.x - before.x) + Math.abs(b.y - before.y);
  }).toBeLessThan(2);
});

test('the header toggle is Mock | Live: Mock is on, and Live is refused with an honest message', async ({ page }) => {
  await page.goto('/');
  const mock = page.getByTestId('mode-mock');
  const live = page.getByTestId('mode-live');
  await expect(mock).toHaveAttribute('aria-pressed', 'true');
  await expect(live).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('mode')).toHaveText('Mode: mock (offline)');
  await expect(page.getByTestId('live-note')).toBeHidden();
  await live.click();
  await expect(page.getByTestId('live-note')).toContainText('Live mode is not available in this lab');
  await expect(mock).toHaveAttribute('aria-pressed', 'true');
  await expect(live).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('banner')).toContainText('MOCK. Simulated.');
  await mock.click();
  await expect(page.getByTestId('live-note')).toBeHidden();
});

test('presenter mode: P toggles it, Esc leaves it, the banner stays, modifier keys and typing in a field do nothing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your rung: Public' })).toBeVisible();
  const app = page.locator('.app');
  const banner = page.getByTestId('banner');
  await page.keyboard.press('p');
  await expect(app).toHaveClass(/app--presenter/);
  await expect(banner).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw trace' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(app).not.toHaveClass(/app--presenter/);
  await page.keyboard.press('Control+p');
  await page.keyboard.press('Meta+p');
  await page.keyboard.press('Alt+p');
  await expect(app).not.toHaveClass(/app--presenter/);
  await page.getByLabel('Reason (required)').fill('p');
  await page.getByLabel('Reason (required)').press('p');
  await expect(app).not.toHaveClass(/app--presenter/);
  await page.getByLabel('Reason (required)').blur();
  await page.keyboard.press('P');
  await expect(app).toHaveClass(/app--presenter/);
  await expect(banner).toBeVisible();
});

test('buttons that cannot act are aria-disabled, not disabled, and keep keyboard focus', async ({ page }) => {
  await page.goto('/');
  const stepUp = page.getByRole('button', { name: 'Step-up check' });
  await expect(stepUp).toHaveAttribute('aria-disabled', 'true');
  expect(await stepUp.evaluate((el) => el.disabled), 'the disabled property is false').toBe(false);
  await stepUp.focus();
  await page.keyboard.press('Enter');
  await expect(stepUp).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your rung: Public' })).toBeVisible();
});

test('the talk track section shows the presenter path as text', async ({ page }) => {
  await page.goto('/');
  const track = page.getByTestId('talk-track');
  await expect(track).toContainText('Presenter path');
  await expect(track).toContainText('Before you start');
  expect(await track.locator('img, script, iframe').count()).toBe(0);
});

test('at 375 px no visible diagram node is covered, and the dark attribution is not a white box', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.locator('.react-flow__node').first().waitFor();
  await page.locator('.diagram').scrollIntoViewIfNeeded();
  const result = await page.evaluate(() => {
    const c = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!c) return { error: 'no canvas' };
    // The canvas, clipped to the screen: a node is only 'visible' where it is on screen and inside the canvas.
    const canvas = { left: Math.max(c.left, 0), right: Math.min(c.right, innerWidth), top: Math.max(c.top, 0), bottom: Math.min(c.bottom, innerHeight) };
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const covered = [];
    let visible = 0;
    for (const n of nodes) {
      const b = n.getBoundingClientRect();
      // The part of the node box that is on screen, inside the canvas.
      const left = Math.max(b.left, canvas.left), right = Math.min(b.right, canvas.right);
      const top = Math.max(b.top, canvas.top), bottom = Math.min(b.bottom, canvas.bottom);
      if (right - left < 8 || bottom - top < 8) continue;
      visible += 1;
      const x = (left + right) / 2, y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !n.contains(hit)) covered.push(n.dataset.id);
    }
    const attribution = document.querySelector('.react-flow__attribution');
    return {
      visible,
      covered,
      controlsCount: document.querySelectorAll('.react-flow__controls').length,
      attributionBg: attribution ? getComputedStyle(attribution).backgroundColor : null,
    };
  });
  expect(result.error).toBeUndefined();
  expect(result.visible).toBeGreaterThanOrEqual(3);
  expect(result.covered, 'nodes covered by something else').toEqual([]);
  expect(result.controlsCount, 'the controls are not drawn on the canvas').toBe(0);
  expect(result.attributionBg, 'attribution follows the dark surface token').toBe('rgb(23, 32, 51)');
});
