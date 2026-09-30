/**
 * Translations for the widget, following JupyterLab's i18n standard (gettext
 * via ITranslator, domain "jstex").
 *
 * The widget is not a JupyterLab plugin, so it cannot ask for ITranslator
 * itself. The jstex labextension (src/index.ts) loads the "jstex" bundle at
 * startup and publishes it under Symbol.for('jstex.i18n'). Outside JupyterLab
 * (VS Code, Colab, Voilà) nothing is published and the widget uses English.
 *
 * Strings MUST be written as literal calls on a variable named `trans`
 * (`trans.__('Search')`) so `jupyterlab-translate extract` finds them.
 */

export interface TranslationBundle {
  __(msgid: string, ...args: unknown[]): string;
  _n(msgid: string, msgidPlural: string, n: number, ...args: unknown[]): string;
  _p(msgctxt: string, msgid: string, ...args: unknown[]): string;
}

export interface SharedI18n {
  languageCode: string;
  bundle: TranslationBundle;
}

/** Shared with src/index.ts (a separate build) — keep the key identical. */
export const I18N_KEY = Symbol.for('jstex.i18n');

/** JupyterLab-compatible placeholder substitution: "%1 of %2". */
export function strfmt(msg: string, ...args: unknown[]): string {
  return msg.replace(/%(\d+)/g, (match, n: string) => {
    const value = args[Number(n) - 1];
    return value === undefined ? match : String(value);
  });
}

export const englishBundle: TranslationBundle = {
  __: (msgid, ...args) => strfmt(msgid, ...args),
  _n: (msgid, msgidPlural, n, ...args) =>
    strfmt(n === 1 ? msgid : msgidPlural, ...args),
  _p: (_ctx, msgid, ...args) => strfmt(msgid, ...args)
};

function shared(): SharedI18n | undefined {
  return (globalThis as Record<symbol, SharedI18n | undefined>)[I18N_KEY];
}

export function getTranslation(): TranslationBundle {
  return shared()?.bundle ?? englishBundle;
}

export function languageCode(): string {
  return shared()?.languageCode ?? 'en';
}
