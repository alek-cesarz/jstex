/**
 * jstex labextension.
 *
 * Stage 1: shares JupyterLab's translation bundle for the "jstex" gettext
 * domain with the jstex widget (which is not a plugin and cannot request
 * ITranslator). The widget reads it from Symbol.for('jstex.i18n') — see
 * js/i18n.ts — and falls back to English when it is absent.
 */
import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ITranslator } from '@jupyterlab/translation';

/** Same key as js/i18n.ts (separate build). */
export const I18N_KEY = Symbol.for('jstex.i18n');

export function publishTranslations(translator: ITranslator | null): void {
  if (!translator) {
    return;
  }
  (globalThis as Record<symbol, unknown>)[I18N_KEY] = {
    languageCode: translator.languageCode,
    bundle: translator.load('jstex')
  };
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@jstex/labextension:i18n',
  description: 'Shares the jstex translation bundle with the jstex widget.',
  autoStart: true,
  optional: [ITranslator],
  activate: (_app: JupyterFrontEnd, translator: ITranslator | null) => {
    publishTranslations(translator);
  }
};

export default plugin;
