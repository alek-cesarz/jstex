import { expect, test } from '@jupyterlab/galata';

test('labextension shares the jstex translation bundle with the widget', async ({
  page
}) => {
  const shared = await page.evaluate(() => {
    const g = (globalThis as any)[Symbol.for('jstex.i18n')];
    return g
      ? {
          lang: String(g.languageCode),
          search: g.bundle.__('Search') as string
        }
      : null;
  });
  expect(shared).not.toBeNull();
  expect(shared!.search).toBe('Search'); // English UI: gettext returns the msgid
});
