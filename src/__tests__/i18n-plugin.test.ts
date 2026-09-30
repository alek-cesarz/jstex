import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin, { I18N_KEY, publishTranslations } from '../index';
import { I18N_KEY as WIDGET_KEY } from '../../js/i18n';

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[I18N_KEY];
});

describe('labextension i18n plugin', () => {
  it('uses the same global key as the widget', () => {
    expect(I18N_KEY).toBe(WIDGET_KEY);
  });

  it('publishes the "jstex" bundle and language code', () => {
    const bundle = { __: (s: string) => `fr:${s}` };
    const translator = { languageCode: 'fr-FR', load: vi.fn(() => bundle) };
    publishTranslations(translator as never);
    expect(translator.load).toHaveBeenCalledWith('jstex');
    expect((globalThis as Record<symbol, unknown>)[I18N_KEY]).toEqual({
      languageCode: 'fr-FR',
      bundle
    });
  });

  it('does nothing without a translator (ITranslator is optional)', () => {
    publishTranslations(null);
    expect((globalThis as Record<symbol, unknown>)[I18N_KEY]).toBeUndefined();
    expect(plugin.autoStart).toBe(true);
    expect(plugin.id).toBe('@jstex/labextension:i18n');
  });
});
