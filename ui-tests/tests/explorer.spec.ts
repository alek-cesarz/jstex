import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

const STAC = 'http://127.0.0.1:8765/v1/';
const SELF = (id: string) => `${STAC}collections/sentinel-2-l2a/items/${id}`;

async function explorerCell(page: Page, variable = 'ex'): Promise<Locator> {
  await page.notebook.setCell(
    0,
    'code',
    `import jstex\n${variable} = jstex.Explorer(stac_url="${STAC}")\n${variable}`
  );
  await page.notebook.runCell(0);
  const w = page.locator('.jp-OutputArea-output .jstex').first();
  await expect(w.locator('eox-map canvas').first()).toBeAttached({
    timeout: 30000
  });
  return w;
}

async function searchAll(w: Locator): Promise<void> {
  await w.locator('input[value="sentinel-2-l2a"]').check();
  await w.locator('.jstex-panel [data-ref="search"]').click();
  await expect(w.locator('tr[data-id]')).toHaveCount(3);
}

async function lastSearchBody(): Promise<Record<string, unknown>> {
  return (await fetch('http://127.0.0.1:8765/__last_search')).json();
}

// Wide enough for layout A (panel beside the map); Galata's default 1024 px
// viewport puts the widget in the narrow, stacked layout.
test.use({ viewport: { width: 1600, height: 1200 } });

/** Run the notebook's last cell (running a cell leaves an empty one below it). */
async function runLastCell(page: Page): Promise<void> {
  await page.notebook.runCell((await page.notebook.getCellCount()) - 1);
}

test.describe('jstex Explorer', () => {
  test.beforeEach(async ({ page }) => {
    await page.notebook.createNew();
  });

  test('search, list selection, details and Python accessor agree', async ({
    page
  }) => {
    const w = await explorerCell(page);
    await expect(w.locator('[data-ref="authText"]')).toHaveText(
      'Not signed in — restricted collections are hidden.'
    );
    await expect(w.locator('.jstex-panel [data-ref="search"]')).toBeDisabled();
    await searchAll(w);
    await expect(w.locator('[data-ref="count"]')).toHaveText(
      '3 loaded · 0 selected · 3 matched'
    );
    expect(Object.keys(await lastSearchBody()).sort()).toEqual([
      'collections',
      'limit'
    ]);

    await w.locator('tr[data-id="S2B_T32TPS_20240717"] td').nth(1).click();
    await expect(w.locator('.jstex-details__id')).toHaveText(
      'S2B_T32TPS_20240717'
    );
    await expect(
      w.locator(`button[data-copy="${SELF('S2B_T32TPS_20240717')}"]`).first()
    ).toBeVisible();
    await w.locator('tr[data-id="S2A_T32TPS_20240722"] input').check();

    await page.notebook.addCell(
      'code',
      'print(ex.selected_item.get_self_href(), [i.id for i in ex.selected_items])'
    );
    const printCell = (await page.notebook.getCellCount()) - 1;
    await page.notebook.runCell(printCell);
    await expect(
      page.locator('.jp-Cell').nth(printCell).locator('.jp-OutputArea-output')
    ).toContainText(`${SELF('S2B_T32TPS_20240717')} ['S2A_T32TPS_20240722']`);
  });

  test('clicking stacked footprints lists them in a popup, like STEX', async ({
    page
  }) => {
    const w = await explorerCell(page);
    await searchAll(w);
    await page.waitForTimeout(1000); // zoom-to-results
    await w.locator('eox-map').scrollIntoViewIfNeeded();
    const box = (await w.locator('eox-map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(w.locator('.jstex-fp [data-id]')).toHaveCount(3);
    await w.locator('.jstex-fp [data-id="S2B_T32TPS_20240717"]').click();
    await expect(w.locator('.jstex-details__id')).toHaveText(
      'S2B_T32TPS_20240717'
    );
    await expect(w.locator('.jstex-fp')).toHaveCount(0);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(w.locator('.jstex-fp .jstex-active')).toHaveAttribute(
      'data-id',
      'S2B_T32TPS_20240717'
    );
    await page.keyboard.press('Escape');
    await expect(w.locator('.jstex-fp')).toHaveCount(0);
  });

  test('drawing a box sets the one area of interest and the search sends intersects', async ({
    page
  }) => {
    const w = await explorerCell(page);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('eox-map').scrollIntoViewIfNeeded();
    const box = (await w.locator('eox-map').boundingBox())!;
    await w.locator('[data-draw="Box"]').click();
    await expect(w.locator('.jstex-draw-tip')).toBeVisible();
    await page.mouse.click(box.x + 100, box.y + 80);
    await page.mouse.click(box.x + 300, box.y + 220);
    await expect(w.locator('[data-ref="chipText"]')).toContainText('km²');
    await expect(w.locator('.jstex-draw-tip')).toBeHidden();
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    expect(((await lastSearchBody()).intersects as { type: string }).type).toBe(
      'Polygon'
    );
    await w.locator('[data-ref="remove"]').click();
    await expect(w.locator('[data-ref="chip"]')).toBeHidden();
  });

  test('collection search, info, open-ended date, filter and GeoJSON upload reach the POST body', async ({
    page
  }) => {
    const w = await explorerCell(page);
    await w.locator('[data-ref="collSearch"]').fill('sentinel-2');
    await expect(w.locator('.jstex-coll')).toHaveCount(2);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('input[value="sentinel-2-l1c"]').check();
    await w.locator('[data-info="sentinel-2-l2a"]').click();
    await expect(w.locator('.jstex-coll__about')).toContainText(
      '2015-06-27 → ongoing'
    );
    await w.locator('[data-ref="from"]').fill('2024-07-01');
    await w.locator('[data-ref="from"]').dispatchEvent('change');
    await expect(
      w.locator('[data-panel-section="filters"] [data-ref="hint"]')
    ).toHaveText('Fields shared by all 2 collections.');
    await w.locator('[data-panel-section="filters"] [data-ref="add"]').click();
    const row = w.locator('[data-row]').first();
    await row.locator('[data-f="op"]').selectOption('<=');
    await row.locator('[data-f="value"]').fill('abc');
    await expect(row.locator('[data-err]')).toHaveText('Enter a number.');
    await expect(w.locator('.jstex-panel [data-ref="search"]')).toBeDisabled();
    await row.locator('[data-f="value"]').fill('20');
    await w.locator('[data-ref="file"]').setInputFiles('tests/area.geojson');
    await expect(w.locator('[data-ref="chipText"]')).toHaveText(
      'Polygon · 3,120 km²'
    );
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(3);
    const body = await lastSearchBody();
    expect(body.collections).toEqual(['sentinel-2-l2a', 'sentinel-2-l1c']);
    expect(body.datetime).toBe('2024-07-01T00:00:00Z/2099-12-31T23:59:59Z');
    expect(body.filter).toEqual({
      op: '<=',
      args: [{ property: 'eo:cloud_cover' }, 20]
    });
    expect((body.intersects as { type: string }).type).toBe('Polygon');
  });

  test('the panel collapses to a rail and back', async ({ page }) => {
    const w = await explorerCell(page);
    await w.locator('input[value="sentinel-2-l2a"]').check();
    await w.locator('[data-ref="collapse"]').click();
    await expect(w.locator('.jstex-rail')).toBeVisible();
    await expect(w.locator('[data-rail="collections"]')).toHaveAttribute(
      'title',
      'Collections: sentinel-2-l2a'
    );
    await w.locator('[data-rail="filters"]').click();
    await expect(w.locator('.jstex-panel')).toBeVisible();
  });

  test('follows the JupyterLab light/dark theme, including the basemap', async ({
    page
  }) => {
    const w = await explorerCell(page);
    const basemapUrl = () =>
      w.locator('eox-map').evaluate(
        (el: any) =>
          el.map
            .getLayers()
            .getArray()
            .find((l: any) => l.get('id') === 'basemap')
            .getSource()
            .getUrls()[0] as string
      );
    await expect(w).toHaveAttribute('data-theme', 'light');
    expect(await basemapUrl()).toContain('voyager');
    await page.theme.setDarkTheme();
    await expect(w).toHaveAttribute('data-theme', 'dark');
    expect(await basemapUrl()).toContain('alidade_smooth_dark');
    await page.theme.setLightTheme();
    await expect(w).toHaveAttribute('data-theme', 'light');
  });

  test('two explorers in one notebook are independent', async ({ page }) => {
    const w1 = await explorerCell(page, 'ex1');
    await page.notebook.addCell(
      'code',
      `ex2 = jstex.Explorer(stac_url="${STAC}")\nex2`
    );
    await runLastCell(page);
    const w2 = page.locator('.jp-OutputArea-output .jstex').nth(1);
    await expect(w2.locator('eox-map canvas').first()).toBeAttached({
      timeout: 30000
    });
    await searchAll(w1);
    await expect(w2.locator('input[value="sentinel-2-l2a"]')).not.toBeChecked();
    await expect(w2.locator('tr[data-id]')).toHaveCount(0);
  });
});
