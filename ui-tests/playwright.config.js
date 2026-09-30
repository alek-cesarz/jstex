/**
 * Configuration for Playwright using default from @jupyterlab/galata.
 * A fake STAC API (fake_stac.py) runs next to JupyterLab so e2e runs are deterministic.
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  webServer: [
    {
      command: 'python fake_stac.py',
      url: 'http://127.0.0.1:8765/v1/',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'jlpm start',
      url: 'http://localhost:8888/lab',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI
    }
  ]
};
