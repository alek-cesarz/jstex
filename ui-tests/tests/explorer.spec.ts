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

  test('a footprint clicked on the map scrolls its row into the results list', async ({
    page
  }) => {
    const w = await explorerCell(page);
    await w.locator('input[value="sentinel-1-grd"]').check();
    await w.locator('.jstex-panel [data-ref="search"]').click();
    await expect(w.locator('tr[data-id]')).toHaveCount(30);
    await page.waitForTimeout(1000); // zoom-to-results
    await w.locator('eox-map').scrollIntoViewIfNeeded();
    // The 26th footprint (lon 20.0-20.3) — its row is far below the list's view.
    const target = 'S1A_IW_GRDH_20240726';
    const [px, py] = await w.locator('eox-map').evaluate((el: any) => {
      const R = 20037508.34;
      const x = (20.15 * R) / 180;
      const y =
        ((Math.log(Math.tan(((90 + 45.5) * Math.PI) / 360)) / (Math.PI / 180)) *
          R) /
        180;
      return el.map.getPixelFromCoordinate([x, y]);
    });
    const box = (await w.locator('eox-map').boundingBox())!;
    await page.mouse.click(box.x + px, box.y + py);
    await expect(w.locator('.jstex-details__id')).toHaveText(target);
    const row = w.locator(`tr[data-id="${target}"]`);
    await expect(row).toHaveClass(/jstex-active/);
    const list = (await w.locator('.jstex-results__scroll').boundingBox())!;
    const r = (await row.boundingBox())!;
    expect(r.y).toBeGreaterThanOrEqual(list.y);
    expect(r.y + r.height).toBeLessThanOrEqual(list.y + list.height + 1);
    // ...so its checkbox is right there.
    await row.locator('input[data-toggle]').check();
    await page.notebook.addCell(
      'code',
      'print([i.id for i in ex.selected_items])'
    );
    await runLastCell(page);
    await expect(page.locator('.jp-OutputArea-output').last()).toContainText(
      `['${target}']`
    );
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

  test('the range calendar: start day, end day, a time for each end', async ({
    page
  }) => {
    const w = await explorerCell(page);
    const popup = page.locator(
      'body > .vc.jstex-vc:not([data-vc-calendar-hidden])'
    );
    const from = w.locator('[data-ref="from"]');
    const to = w.locator('[data-ref="to"]');
    const hint = popup.locator('.jstex-vc__hint');
    await from.click();
    await expect(popup).toBeVisible();
    await expect(hint).toHaveText('Pick the start day');
    // The 16th cell of the grid is always in the month shown.
    const month = (await popup
      .locator('[data-vc-date]')
      .nth(15)
      .getAttribute('data-vc-date'))!.slice(0, 8); // "YYYY-MM-"
    const day = (d: string) =>
      popup.locator(`[data-vc-date="${month}${d}"] [data-vc-date-btn]`);

    await popup.locator('[data-vc-time="from"]').fill('6:15');
    await popup.locator('[data-vc-time="from"]').press('Enter');
    await day('10').click();
    await expect(from).toHaveValue(`${month}10 06:15`);
    await expect(popup).toBeVisible(); // still open for the end day
    await expect(hint).toHaveText('Pick the end day');
    await popup.locator('[data-vc-time="to"]').fill('18:45');
    await popup.locator('[data-vc-time="to"]').press('Enter');
    await day('20').click();
    await expect(popup).toBeHidden(); // the second day closes it
    await expect(to).toHaveValue(`${month}20 18:45`);

    // Clicking To with From set picks the end day directly; its time stays.
    await to.click();
    await expect(hint).toHaveText('Pick the end day');
    await expect(popup.locator('[data-jstex-range="in"]')).toHaveCount(9);
    await day('25').click();
    await expect(popup).toBeHidden();
    await expect(to).toHaveValue(`${month}25 18:45`);
    await expect(from).toHaveValue(`${month}10 06:15`);

    // Done closes it without changing anything.
    await from.click();
    await popup.locator('[data-vc-act="done"]').click();
    await expect(popup).toBeHidden();

    await page.notebook.addCell('code', 'print(ex.query["datetime"])');
    await runLastCell(page);
    await expect(page.locator('.jp-OutputArea-output').last()).toContainText(
      `'from': '${month}10T06:15:00Z', 'to': '${month}25T18:45:00Z'`
    );
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
