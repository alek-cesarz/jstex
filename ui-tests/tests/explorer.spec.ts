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
    await expect(w.locator('[data-ref="statusText"]')).toHaveText(
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
    await expect(w.locator('[data-ref="rail"]')).toBeVisible();
    await expect(w.locator('[data-rail="collections"]')).toHaveAttribute(
      'title',
      'Collections: sentinel-2-l2a'
    );
    await w.locator('[data-rail="filters"]').click();
    await expect(w.locator('.jstex-panel')).toBeVisible();
  });

  test('the date picker opens on every click, not just the first', async ({
    page
  }) => {
    const w = await explorerCell(page);
    const popup = page.locator(
      'body > .vc.jstex-vc:not([data-vc-calendar-hidden])'
    );
    const to = w.locator('[data-ref="to"]');
    for (let round = 0; round < 3; round++) {
      await to.click();
      await expect(popup).toBeVisible();
      await page.mouse.click(5, 5); // click elsewhere closes it
      await expect(popup).toBeHidden();
    }
    // After picking a day it opens again too.
    await to.click();
    await popup.locator('[data-vc-date-btn]').nth(10).click();
    await expect(to).not.toHaveValue('');
    const first = await to.inputValue();
    await w.locator('.jstex-panel').click({ position: { x: 5, y: 5 } });
    await to.click();
    await expect(popup).toBeVisible();
    // ...and a second pick still works.
    await popup.locator('[data-vc-date-btn]').nth(12).click();
    await expect(to).not.toHaveValue(first);
    await expect(to).not.toHaveValue('');
  });

  test('the divider resizes the panel and the map can be hidden', async ({
    page
  }) => {
    const w = await explorerCell(page);
    const panel = w.locator('[data-slot="panel"]');
    const before = (await panel.boundingBox())!.width;
    const sp = (await w.locator('[data-ref="splitter"]').boundingBox())!;
    await page.mouse.move(sp.x + sp.width / 2, sp.y + 100);
    await page.mouse.down();
    await page.mouse.move(sp.x + sp.width / 2 + 120, sp.y + 100, { steps: 4 });
    await page.mouse.up();
    const after = (await panel.boundingBox())!.width;
    expect(after - before).toBeGreaterThan(110);

    await w.locator('[data-ref="hideMap"]').click();
    await expect(w.locator('[data-slot="map"]')).toBeHidden();
    await expect(w.locator('[data-ref="mapRail"]')).toBeVisible();
    await page.notebook.addCell(
      'code',
      'print(ex.panel_width, ex.map_collapsed)'
    );
    const printCell = (await page.notebook.getCellCount()) - 1;
    await page.notebook.runCell(printCell);
    await expect(
      page.locator('.jp-Cell').nth(printCell).locator('.jp-OutputArea-output')
    ).toContainText(`${Math.round(after)} True`);

    await w.locator('[data-ref="showMap"]').click();
    await expect(w.locator('[data-slot="map"]')).toBeVisible();
    // The map re-measures itself after being shown again.
    await expect
      .poll(
        async () =>
          (await w.locator('eox-map canvas').first().boundingBox())?.width ?? 0
      )
      .toBeGreaterThan(300);
  });

  test('follows the JupyterLab light/dark theme, including the basemap', async ({
    page
  }) => {
    // Default: OpenFreeMap Positron (vector style). The dark theme gets a raster
    // XYZ basemap here, so switching themes swaps layer kinds too.
    await page.notebook.setCell(
      0,
      'code',
      [
        'import os',
        'os.environ["JSTEX_BASEMAP_DARK_URL"] = "https://tiles.example.org/{z}/{x}/{y}.png"',
        'import jstex',
        `ex = jstex.Explorer(stac_url="${STAC}")`,
        'ex'
      ].join('\n')
    );
    await page.notebook.runCell(0);
    const w = page.locator('.jp-OutputArea-output .jstex').first();
    await expect(w.locator('eox-map canvas').first()).toBeAttached({
      timeout: 30000
    });
    const basemaps = () =>
      w.locator('eox-map').evaluate((el: any) =>
        Object.fromEntries(
          el.map
            .getLayers()
            .getArray()
            .filter((l: any) => String(l.get('id')).startsWith('basemap-'))
            .map((l: any) => [
              l.get('id'),
              {
                visible: l.getVisible(),
                style: l.get('mapboxStyle') ?? null,
                url: l.getSource?.()?.getUrls?.()?.[0] ?? null
              }
            ])
        )
      );
    await expect(w).toHaveAttribute('data-theme', 'light');
    expect(await basemaps()).toEqual({
      'basemap-style': {
        visible: true,
        style: 'https://tiles.openfreemap.org/styles/positron',
        url: null
      }
    });
    await page.theme.setDarkTheme();
    await expect(w).toHaveAttribute('data-theme', 'dark');
    await expect.poll(basemaps).toEqual({
      'basemap-style': {
        visible: false,
        style: 'https://tiles.openfreemap.org/styles/positron',
        url: null
      },
      'basemap-xyz': {
        visible: true,
        style: null,
        url: 'https://tiles.example.org/{z}/{x}/{y}.png'
      }
    });
    await page.theme.setLightTheme();
    await expect(w).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(async () => (await basemaps())['basemap-style'].visible)
      .toBe(true);

    // Zoom buttons follow the widget's control style; attribution is shown.
    const controls = await w.locator('eox-map').evaluate((el: any) => {
      const zoomIn = el.shadowRoot.querySelector('button.ol-zoom-in');
      const cs = getComputedStyle(zoomIn);
      return {
        width: cs.width,
        radius: cs.borderTopLeftRadius,
        attribution: Boolean(el.shadowRoot.querySelector('.ol-attribution'))
      };
    });
    expect(controls).toEqual({
      width: '28px',
      radius: '0px',
      attribution: true
    });
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
