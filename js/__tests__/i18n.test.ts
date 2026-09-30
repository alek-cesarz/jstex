import { afterEach, describe, expect, it } from 'vitest';
import {
  englishBundle,
  getTranslation,
  I18N_KEY,
  languageCode,
  strfmt
} from '../i18n';
import { createStrings } from '../strings';

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[I18N_KEY];
});

describe('i18n', () => {
  it('strfmt fills %1..%n like JupyterLab', () => {
    expect(strfmt('%1 of %2', 3, 9)).toBe('3 of 9');
    expect(strfmt('%1 and %3', 'a')).toBe('a and %3');
  });

  it('falls back to English outside JupyterLab', () => {
    expect(getTranslation()).toBe(englishBundle);
    expect(languageCode()).toBe('en');
    expect(englishBundle._n('%1 item', '%1 items', 2, 2)).toBe('2 items');
  });

  it('uses the bundle published by the labextension', () => {
    const bundle = {
      __: (m: string, ...a: unknown[]) =>
        strfmt(m === 'Search' ? 'Suchen' : m, ...a),
      _n: englishBundle._n,
      _p: englishBundle._p
    };
    (globalThis as Record<symbol, unknown>)[I18N_KEY] = {
      languageCode: 'de-DE',
      bundle
    };
    expect(languageCode()).toBe('de-DE');
    const S = createStrings(getTranslation());
    expect(S.search).toBe('Suchen');
    expect(S.collectionsCount(3, 214)).toBe('3 of 214');
    expect(S.loaded(1)).toBe('1 loaded');
  });
});
