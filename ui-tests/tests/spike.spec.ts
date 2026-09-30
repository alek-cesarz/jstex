import { expect, test } from '@jupyterlab/galata';

test.describe('feasibility spikes', () => {
  test('eox-map renders inside a notebook cell output', async ({ page }) => {
    await page.notebook.createNew();
    await page.notebook.setCell(0, 'code', 'import jstex\njstex.Explorer()');
    await page.notebook.run();
    const map = page.locator('.jp-OutputArea-output .jstex eox-map');
    await expect(map).toBeVisible({ timeout: 30000 });
    await expect(map.locator('canvas').first()).toBeAttached({
      timeout: 30000
    });
    // Re-running the cell re-evaluates the bundle: the define guard must keep it working.
    await page.notebook.runCell(0);
    await expect(
      page.locator('.jp-OutputArea-output .jstex eox-map canvas').first()
    ).toBeAttached({ timeout: 30000 });
  });

  test('messages and trait updates sent from a worker thread arrive', async ({
    page
  }) => {
    await page.notebook.createNew();
    const code = [
      'import anywidget, threading, time, traitlets',
      'class T(anywidget.AnyWidget):',
      '    _esm = """export default { render({ model, el }) {',
      "      model.on('msg:custom', (m) => { el.dataset.n = String(m.n); });",
      "      model.on('change:v', () => { el.dataset.v = String(model.get('v')); });",
      '    } }"""',
      '    v = traitlets.Int(0).tag(sync=True)',
      't = T()',
      'def work():',
      '    for n in range(1, 51):',
      '        time.sleep(0.02); t.send({"n": n}); t.v = n',
      'threading.Thread(target=work, daemon=True).start()'
    ].join('\n');
    // One line + `t`: the notebook editor auto-indents typed continuation lines.
    await page.notebook.setCell(0, 'code', `exec(${JSON.stringify(code)})\nt`);
    await page.notebook.run();
    const out = page.locator('.jp-OutputArea-output [data-n]');
    await expect(out).toHaveAttribute('data-n', '50', { timeout: 20000 });
    await expect(out).toHaveAttribute('data-v', '50', { timeout: 20000 });
  });
});
