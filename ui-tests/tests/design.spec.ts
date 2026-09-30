import { expect, test } from '@jupyterlab/galata';

/**
 * Design-review screenshots (not an assertion suite). Run with
 *   JSTEX_DESIGN_SHOTS=1 jlpm playwright test tests/design.spec.ts
 * Output: ui-tests/design-review/<width>-<theme>-<state>.png (git-ignored).
 */
const STAC = 'http://127.0.0.1:8765/v1/';
const WIDTHS = [1400, 1100, 800];

test.skip(
  !process.env.JSTEX_DESIGN_SHOTS,
  'set JSTEX_DESIGN_SHOTS=1 to capture design-review screenshots'
);

for (const width of WIDTHS) {
  test(`search panel and widget at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1600 });
    await page.notebook.createNew();
    await page.notebook.setCell(
      0,
      'code',
      `import jstex\nex = jstex.Explorer(stac_url="${STAC}")\nex`
    );
    await page.notebook.runCell(0);
    const w = page.locator('.jp-OutputArea-output .jstex').first();
    await expect(w.locator('eox-map canvas').first()).toBeAttached({
      timeout: 30000
    });
    const shot = async (state: string) => {
      for (const theme of ['light', 'dark'] as const) {
        if (theme === 'dark') await page.theme.setDarkTheme();
        else await page.theme.setLightTheme();
        await w.screenshot({
          path: `design-review/${width}-${theme}-${state}.png`
        });
      }
      await page.theme.setLightTheme();
    };
    await shot('1-empty');
    await w.locator('[data-ref="collSearch"]').fill('sentinel-2');
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('input[value="sentinel-2-l1c"]').check();
    await w.locator('[data-info="sentinel-2-l2a"]').click();
    await w.locator('[data-ref="from"]').fill('2024-07-01');
    await w.locator('[data-ref="from"]').dispatchEvent('change');
    await w.locator('[data-panel-section="filters"] [data-ref="add"]').click();
    await w.locator('[data-row] [data-f="value"]').first().fill('x');
    await shot('2-editing-with-error');
    await w.locator('[data-row] [data-f="value"]').first().fill('20');
    await w.locator('[data-ref="file"]').setInputFiles('tests/area.geojson');
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    await w.locator('tr[data-id="S2B_T32TPS_20240717"] td').nth(1).click();
    await shot('3-results');
    // The rail exists only in the wide layout (widget wider than 760 px).
    if (await w.locator('[data-ref="collapse"]').isVisible()) {
      await w.locator('[data-ref="collapse"]').click();
      await shot('4-collapsed');
    }
  });
}
