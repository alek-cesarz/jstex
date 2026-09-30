import { describe, expect, it, vi } from 'vitest';
import {
  createFootprintPopup,
  popupHtml,
  popupPosition
} from '../ui/footprint-popup';
import { item } from './helpers';

describe('footprint popup', () => {
  it('lists every overlapping item and marks the active one', () => {
    const html = popupHtml([item('a'), item('b')], 'b');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('strong')!.textContent).toBe(
      '2 overlapping items'
    );
    expect(
      [...div.querySelectorAll<HTMLElement>('[data-id]')].map(b => b.dataset.id)
    ).toEqual(['a', 'b']);
    expect(
      div.querySelector('[data-id="b"]')!.classList.contains('jstex-active')
    ).toBe(true);
    expect(div.textContent).toContain('☁ 4.1%');
  });

  it('positions below the click, flips above near the bottom, stays inside', () => {
    const size = { width: 300, height: 150 };
    const box = { width: 800, height: 450 };
    expect(popupPosition([400, 100], size, box)).toEqual({
      left: 250,
      top: 112
    });
    expect(popupPosition([400, 400], size, box)).toEqual({
      left: 250,
      top: 238
    });
    expect(popupPosition([10, 10], size, box).left).toBe(8);
    expect(popupPosition([790, 10], size, box).left).toBe(492);
  });

  it('picking a row activates it and closes; Escape and outside clicks close', async () => {
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    const onPick = vi.fn();
    const popup = createFootprintPopup(wrap, onPick);
    popup.show([100, 100], [item('a'), item('b')], null);
    (wrap.querySelector('[data-id="b"]') as HTMLElement).click();
    expect(onPick).toHaveBeenCalledWith('b');
    expect(popup.isOpen()).toBe(false);

    popup.show([100, 100], [item('a'), item('b')], null);
    await new Promise(r => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popup.isOpen()).toBe(false);

    popup.show([100, 100], [item('a'), item('b')], null);
    await new Promise(r => setTimeout(r, 0));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(popup.isOpen()).toBe(false);
  });
});
