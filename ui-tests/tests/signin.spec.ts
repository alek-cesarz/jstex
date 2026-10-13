import { expect, test, type Page } from '@jupyterlab/galata';

const STAC = 'http://127.0.0.1:8765/v1/';
const ISSUER = 'http://127.0.0.1:8765/oidc/realms/test';

test.use({ viewport: { width: 1600, height: 1200 } });

async function explorer(page: Page, loginClient: string | null) {
  const code = [
    'import os, tempfile',
    'os.environ["XDG_DATA_HOME"] = tempfile.mkdtemp()',
    `os.environ["JSTEX_OIDC_ISSUER"] = "${ISSUER}"`,
    'os.environ["JSTEX_PASSWORD_CLIENT_ID"] = "jstex-test"',
    'os.environ["JSTEX_PASSWORD_LOGIN"] = "1"',
    loginClient
      ? `os.environ["JSTEX_LOGIN_CLIENT_ID"] = "${loginClient}"`
      : 'os.environ.pop("JSTEX_LOGIN_CLIENT_ID", None)',
    'import jstex',
    `ex = jstex.Explorer(profile="none", stac_url="${STAC}")`,
    'ex'
  ].join('\n');
  await page.notebook.setCell(0, 'code', `exec(${JSON.stringify(code)})\nex`);
  await page.notebook.runCell(0);
  const w = page.locator('.jp-OutputArea-output .jstex').first();
  await expect(w.locator('[data-ref="statusText"]')).toHaveText(
    'Not signed in — restricted collections are hidden.',
    { timeout: 30000 }
  );
  return w;
}

test.describe('sign-in', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.get('http://127.0.0.1:8765/__reset');
    await page.notebook.createNew();
  });

  test('device login shows the code, completes, and restricted collections appear', async ({
    page
  }) => {
    const w = await explorer(page, 'jstex-test');
    await expect(w.locator('text=Restricted L2A')).toHaveCount(0);
    await w.locator('[data-ref="signIn"]').click();
    await expect(w.locator('[data-ref="code"]')).toHaveText('WDJB-MJHT');
    await page.request.get('http://127.0.0.1:8765/__approve');
    await expect(w.locator('[data-ref="statusText"]')).toHaveText(
      'Signed in (device login) as alice',
      { timeout: 15000 }
    );
    await expect(w.locator('text=Restricted L2A')).toBeVisible();
    await w.locator('[data-ref="signOut"]').click();
    await expect(w.locator('[data-ref="statusText"]')).toHaveText(
      'Not signed in — restricted collections are hidden.'
    );
    await expect(w.locator('text=Restricted L2A')).toHaveCount(0);
  });

  test('without a configured client id the user enters one', async ({
    page
  }) => {
    const w = await explorer(page, null);
    await w.locator('[data-ref="signIn"]').click();
    await w.locator('[data-ref="clientId"]').fill('typed-client');
    await w.locator('[data-ref="continue"]').click();
    await expect(w.locator('[data-ref="code"]')).toHaveText('WDJB-MJHT');
    await w.locator('[data-ref="cancelLogin"]').click();
    await expect(w.locator('[data-ref="box"]')).toBeHidden();
  });

  test('password login: wrong password, then the right one', async ({
    page
  }) => {
    const w = await explorer(page, null);
    await w.locator('[data-ref="signIn"]').click();
    await w.locator('[data-ref="usePassword"]').click();
    await w.locator('[data-ref="username"]').fill('alice');
    await w.locator('[data-ref="password"]').fill('wrong');
    await w.locator('[data-ref="submitPassword"]').click();
    await expect(w.locator('[data-ref="box"] [role="alert"]')).toHaveText(
      'Wrong username or password.'
    );
    // The error offers "Try again" (device login); with no client id configured
    // that shows the client-id step, which offers "Use password instead".
    await w.locator('[data-ref="tryAgain"]').click();
    await w.locator('[data-ref="usePassword"]').click();
    await w.locator('[data-ref="username"]').fill('alice');
    await w.locator('[data-ref="password"]').fill('secret');
    await w.locator('[data-ref="submitPassword"]').click();
    await expect(w.locator('[data-ref="statusText"]')).toHaveText(
      'Signed in (password) as alice',
      { timeout: 15000 }
    );
  });
});
