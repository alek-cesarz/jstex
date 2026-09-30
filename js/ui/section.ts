/** A collapsible panel section: header (caret, title, summary when closed, badge) + body. */
import { escapeHtml } from '../format';
import { ICON } from '../icons';
import type { SectionId } from '../types';

export interface Section {
  el: HTMLElement;
  body: HTMLElement;
  /** Open/closed, one-line summary (shown when closed) and badge text ('' hides it). */
  update(open: boolean, summary: string, badge: string): void;
}

export function createSection(
  id: SectionId,
  title: string,
  extraTitle = ''
): Section {
  const el = document.createElement('section');
  el.className = 'jstex-section';
  el.dataset.panelSection = id;
  el.innerHTML = `
    <button type="button" class="jstex-section__head" data-toggle-section="${id}" aria-expanded="true">
      <span class="jstex-section__caret">${ICON.chevronRight}</span>
      <span class="jstex-section__title">${escapeHtml(title)}${extraTitle ? ` <span class="jstex-muted">${escapeHtml(extraTitle)}</span>` : ''}</span>
      <span class="jstex-section__sum"></span>
      <span class="jstex-badge"></span>
    </button>
    <div class="jstex-section__body"></div>`;
  const head = el.querySelector('.jstex-section__head') as HTMLElement;
  const sum = el.querySelector('.jstex-section__sum') as HTMLElement;
  const badge = el.querySelector('.jstex-badge') as HTMLElement;
  const body = el.querySelector('.jstex-section__body') as HTMLElement;
  return {
    el,
    body,
    update(open, summary, badgeText) {
      el.classList.toggle('jstex-section--closed', !open);
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      sum.textContent = open ? '' : summary;
      sum.title = summary;
      badge.textContent = badgeText;
      badge.hidden = !badgeText;
    }
  };
}
