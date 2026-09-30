/**
 * Date range (UTC), as in STEX: From / To text fields that open a
 * vanilla-calendar-pro popup (date grid + 24 h time picker, Today / Clear).
 * Typing "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" works too. Without a time, From
 * starts the day and To ends it. Either end may be empty; the search sends it
 * closed (1900 / 2099). From after To is flagged here and blocks Search.
 */
import { Calendar, time as timePicker, type Range } from 'vanilla-calendar-pro';
import 'vanilla-calendar-pro/styles/index.css';
import 'vanilla-calendar-pro/styles/themes/light.css';
import 'vanilla-calendar-pro/styles/themes/dark.css';
import type { Actions } from '../actions';
import { dateInputToIso, escapeHtml, isoToDateInput } from '../format';
import { languageCode } from '../i18n';
import { ICON } from '../icons';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState } from '../types';

type Datetime = ExplorerState['query']['datetime'];

const PLACEHOLDER = 'YYYY-MM-DD HH:MM';
/** Widget colours copied onto the popup (it lives in <body>, outside .jstex). */
const POPUP_VARS = [
  '--jstex-accent',
  '--jstex-fg',
  '--jstex-muted',
  '--jstex-bg',
  '--jstex-bg2',
  '--jstex-border',
  '--jstex-font'
];

export function datesSummary(datetime: Datetime): string {
  if (!datetime?.from && !datetime?.to) return '';
  return `${isoToDateInput(datetime.from, false) || S.open} → ${isoToDateInput(datetime.to, true) || S.open}`;
}

/** Both ends set and From later than To (the API would answer HTTP 400). */
export function datesInverted(datetime: Datetime): boolean {
  return Boolean(datetime?.from && datetime?.to && datetime.from > datetime.to);
}

export function mountDates(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: Pick<Actions, 'setQuery'>
): () => void {
  el.innerHTML = `
    <div class="jstex-dates">
      <label class="jstex-dates__label" for="" data-ref="fromLabel">${escapeHtml(S.from)}</label>
      <input type="text" class="jstex-control jstex-dates__input" data-ref="from" placeholder="${PLACEHOLDER}" autocomplete="off" spellcheck="false">
      <label class="jstex-dates__label" for="" data-ref="toLabel">${escapeHtml(S.to)}</label>
      <input type="text" class="jstex-control jstex-dates__input" data-ref="to" placeholder="${PLACEHOLDER}" autocomplete="off" spellcheck="false">
      <button type="button" class="jstex-icon jstex-dates__clear" data-ref="clear" title="${escapeHtml(S.clearDates)}" aria-label="${escapeHtml(S.clearDates)}">${ICON.close}</button>
    </div>
    <div class="jstex-hint jstex-hint--err" role="alert" data-ref="error" hidden></div>
    <div class="jstex-hint">${escapeHtml(S.datesHint)}</div>`;
  const ref = <T extends HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const from = ref<HTMLInputElement>('from');
  const to = ref<HTMLInputElement>('to');
  const clear = ref<HTMLElement>('clear');
  const error = ref<HTMLElement>('error');
  // Unique ids so the labels work with several explorers on a page.
  const uid = Math.random().toString(36).slice(2, 8);
  from.id = `jstex-from-${uid}`;
  to.id = `jstex-to-${uid}`;
  ref<HTMLLabelElement>('fromLabel').htmlFor = from.id;
  ref<HTMLLabelElement>('toLabel').htmlFor = to.id;

  const showError = (message: string, bad: HTMLInputElement[]) => {
    error.textContent = message;
    error.hidden = !message;
    for (const input of [from, to])
      input.classList.toggle('jstex-invalid', bad.includes(input));
  };

  const update = (s: ExplorerState) => {
    const f = isoToDateInput(s.query.datetime?.from, false);
    const t = isoToDateInput(s.query.datetime?.to, true);
    if (document.activeElement !== from && from.value !== f) from.value = f;
    if (document.activeElement !== to && to.value !== t) to.value = t;
    clear.hidden = !(f || t || from.value || to.value);
  };

  /** Parse both fields; commit only when both are valid (a bad field keeps the query). */
  const commit = () => {
    const f = dateInputToIso(from.value, false);
    const t = dateInputToIso(to.value, true);
    if (f === null || t === null) {
      const bad = f === null ? from : to;
      showError(S.invalidDate(f === null ? S.from : S.to), [bad]);
      return;
    }
    const datetime =
      f || t ? { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) } : null;
    showError(
      datesInverted(datetime) ? S.fromAfterTo : '',
      datesInverted(datetime) ? [from, to] : []
    );
    actions.setQuery({ datetime });
    closeCalendars(); // re-created with the new selection on next open
  };

  // ── calendar popups (created on first use; jsdom tests never open them) ──
  const calendars = new Map<HTMLInputElement, () => void>();
  const closeCalendars = () => {
    calendars.forEach(destroy => destroy());
    calendars.clear();
  };
  const openCalendar = (input: HTMLInputElement, endOfDay: boolean) => {
    if (calendars.has(input)) return;
    const iso = dateInputToIso(input.value, endOfDay);
    // An empty field opens on the other end's month (else the current month).
    const other = endOfDay ? from : to;
    const shown = iso || dateInputToIso(other.value, !endOfDay);
    const time = iso ? iso.slice(11, 16) : '';
    const noTime = !iso || isoToDateInput(iso, endOfDay).length === 10;
    let onScroll: (() => void) | null = null;
    const pick = (date: string | undefined, hhmm: string) => {
      if (!date) return;
      input.value = hhmm && hhmm !== '00:00' ? `${date} ${hhmm}` : date;
      commit();
    };
    const cal = new Calendar(input, {
      inputMode: true,
      extensions: [timePicker], // the 24 h time picker is an extension in v3.4
      positionToInput: 'auto',
      locale: languageCode().replace('_', '-'),
      selectedTheme: store.get().dark ? 'dark' : 'light',
      themeAttrDetect: '',
      selectionDatesMode: 'single',
      selectionTimeMode: 24,
      timeStepMinute: 1,
      selectedDates: iso ? [iso.slice(0, 10)] : [],
      ...(shown
        ? {
            selectedMonth: (Number(shown.slice(5, 7)) - 1) as Range<12>,
            selectedYear: Number(shown.slice(0, 4))
          }
        : {}),
      selectedTime: noTime ? '00:00' : time,
      onClickDate(self) {
        pick(self.context.selectedDates[0], self.context.selectedTime);
      },
      onChangeTime(self) {
        pick(self.context.selectedDates[0], self.context.selectedTime);
      },
      onShow(self) {
        const popup = self.context.mainElement;
        popup.classList.add('jstex-vc');
        const styles = getComputedStyle(el);
        for (const name of POPUP_VARS)
          popup.style.setProperty(name, styles.getPropertyValue(name));
        requestAnimationFrame(() => reposition(input, popup));
        // The notebook scrolls inside its panel: close instead of floating away.
        onScroll = () => self.hide();
        window.addEventListener('scroll', onScroll, true);
        if (popup.querySelector('.jstex-vc__actions')) return;
        const bar = document.createElement('div');
        bar.className = 'jstex-vc__actions';
        bar.innerHTML = `<button type="button" data-vc-act="today">${escapeHtml(S.today)}</button><button type="button" data-vc-act="clear">${escapeHtml(S.clear)}</button>`;
        bar.addEventListener('click', e => {
          const act = (e.target as HTMLElement).closest<HTMLElement>(
            '[data-vc-act]'
          )?.dataset.vcAct;
          if (!act) return;
          input.value =
            act === 'today' ? new Date().toISOString().slice(0, 10) : '';
          self.hide();
          commit();
        });
        popup.appendChild(bar);
      },
      onHide() {
        if (onScroll) window.removeEventListener('scroll', onScroll, true);
        onScroll = null;
      }
    });
    const cleanup = cal.init();
    calendars.set(input, () => {
      if (onScroll) window.removeEventListener('scroll', onScroll, true);
      cleanup?.();
      cal.destroy();
    });
    cal.show();
  };

  for (const [input, endOfDay] of [
    [from, false],
    [to, true]
  ] as const) {
    input.addEventListener('change', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit();
    });
    input.addEventListener('click', () => openCalendar(input, endOfDay));
  }
  clear.addEventListener('click', () => {
    from.value = '';
    to.value = '';
    commit();
  });

  update(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.query.datetime !== prev.query.datetime) update(s);
    if (s.dark !== prev.dark) closeCalendars();
  });
  return () => {
    unsubscribe();
    closeCalendars();
  };
}

/**
 * Re-apply the popup's vertical position with measured sizes (from STEX: the
 * library can read offsetHeight before layout and overlap the input).
 */
function reposition(input: HTMLInputElement, popup: HTMLElement): void {
  const position = popup.dataset.vcPosition;
  if (position !== 'top' && position !== 'bottom') return;
  const top = input.getBoundingClientRect().top + window.scrollY;
  popup.style.top = `${position === 'top' ? top - popup.offsetHeight : top + input.offsetHeight}px`;
}
