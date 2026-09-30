import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { requestAPI } from './request';

/**
 * Initialization data for the @jstex/labextension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jstex/labextension:plugin',
  description: 'STEX-light: STAC explorer widget for JupyterLab',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension @jstex/labextension is activated!');

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jstex server extension appears to be missing.\n${reason}`
        );
      });
  }
};

export default plugin;
