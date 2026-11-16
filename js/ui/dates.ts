/**
 * Date range (UTC), as in STEX: From / To text fields. Clicking either opens
 * one vanilla-calendar-pro range calendar: the first day picked sets From, the
 * second sets To and closes it (clicking To with From set picks To directly).
 * Each end has its own 24 h time field in the popup; Today / Clear / Done.
 * Typing "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" works too. Without a time, From
 * starts the day and To ends it. Either end may be empty; the search sends it
 * closed (1900 / 2099). From after To is flagged here and blocks Search.
 */
import { Calendar, type Range } from 'vanilla-calendar-pro';
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
  '--jstex-error',
  '--jstex-font'
];

export type RangeEnd = 'from' | 'to';
/** The two fields' text ("YYYY-MM-DD" or "YYYY-MM-DD HH:MM[:SS]"), or two times. */
export interface RangeFields {
  from: string;
  to: string;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const dayOf = (text: string) => text.trim().slice(0, 10);
const timeOf = (text: string) => text.trim().slice(11).trim();
const withTime = (day: string, time: string) =>
  day && time ? `${day} ${time}` : day;

/** A 24 h time as typed -> "HH:MM[:SS]"; "" for none; null when invalid. */
export function normTime(text: string): string | null {
  const t = text.trim();
  if (!t) return '';
  const m = TIME_RE.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] ?? 0) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}${m[3] ? `:${m[3]}` : ''}`;
}

/**
 * A day clicked in the range calendar. `next` is the end it sets; `times` are
 * the popup's time fields. Setting To ends the pick (`done`); a day before
 * From, or a new From after To, starts the range again from that day.
 */
export function pickDay(
  state: { fields: RangeFields; times: RangeFields; next: RangeEnd },
  day: string
): { fields: RangeFields; next: RangeEnd; done: boolean } {
  const { fields, times, next } = state;
  const fromDay = dayOf(fields.from);
  if (next === 'to' && (!fromDay || day >= fromDay))
    return {
      fields: { ...fields, to: withTime(day, times.to) },
      next: 'from',
      done: true
    };
  const toDay = dayOf(fields.to);
  return {
    fields: {
      from: withTime(day, times.from),
      to: toDay && toDay < day ? '' : fields.to
    },
    next: 'to',
    done: false
  };
}

/** A time typed in the popup, applied to its end (which needs a day already). */
export function setTime(
  fields: RangeFields,
  end: RangeEnd,
  time: string
): RangeFields {
  const day = dayOf(fields[end]);
  return day ? { ...fields, [end]: withTime(day, time) } : { ...fields };
}

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
  };

  // ── range calendar popup (created on first use; jsdom tests never open it) ──
  // One calendar per view for both fields: it is anchored to the To field
  // (below both) and positioned against the whole dates block. Destroying it
  // from its own click handler (an earlier version did) broke reopening, so it
  // lives for the life of the view.
  let popup: Popup | null = null;
  const closeCalendars = () => {
    popup?.destroy();
    popup = null;
  };
  const fields = (): RangeFields => ({ from: from.value, to: to.value });
  const write = (f: RangeFields) => {
    from.value = f.from;
    to.value = f.to;
    commit();
  };
  // The library clicks its anchor (To) while it shows the popup; that click
  // must not re-open it for To.
  let opening = false;
  const openCalendar = (opener: RangeEnd) => {
    if (opening) return;
    // Clicking To with From set completes the range; else start at the field clicked.
    const next: RangeEnd = opener === 'to' && from.value ? 'to' : opener;
    if (!popup) popup = createPopup(el, to, store.get().dark, fields, write);
    opening = true;
    try {
      popup.open(next);
    } finally {
      opening = false;
    }
  };

  for (const [input, endOfDay] of [
    [from, false],
    [to, true]
  ] as const) {
    input.addEventListener('change', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit();
    });
    input.addEventListener('click', () =>
      openCalendar(endOfDay ? 'to' : 'from')
    );
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

interface Popup {
  open(next: RangeEnd): void;
  destroy(): void;
}

/** The range calendar: one per view, for both fields (see mountDates). */
function createPopup(
  root: HTMLElement,
  anchor: HTMLInputElement,
  dark: boolean,
  getFields: () => RangeFields,
  write: (f: RangeFields) => void
): Popup {
  const block = root.querySelector('.jstex-dates') as HTMLElement;
  let next: RangeEnd = 'from';
  let times: RangeFields = { from: '', to: '' };
  let main: HTMLElement | null = null;
  let onScroll: (() => void) | null = null;

  const paintDay = (dateEl: HTMLElement, a: string, b: string) => {
    const day = dateEl.dataset.vcDate ?? '';
    const mark =
      day === a
        ? 'from'
        : day === b
          ? 'to'
          : a && b && day > a && day < b
            ? 'in'
            : '';
    if (mark) dateEl.dataset.jstexRange = mark;
    else delete dateEl.dataset.jstexRange;
  };
  const paint = () => {
    if (!main) return;
    const f = getFields();
    main
      .querySelectorAll<HTMLElement>('[data-vc-date]')
      .forEach(d => paintDay(d, dayOf(f.from), dayOf(f.to)));
    const hint = main.querySelector<HTMLElement>('.jstex-vc__hint');
    if (hint) hint.textContent = next === 'from' ? S.pickStart : S.pickEnd;
    main.querySelectorAll<HTMLInputElement>('[data-vc-time]').forEach(input => {
      const end = input.dataset.vcTime as RangeEnd;
      if (document.activeElement !== input) input.value = times[end];
      input.closest('label')!.classList.toggle('jstex-vc__next', end === next);
      input.classList.remove('jstex-invalid');
    });
  };
  const pick = (day: string) => {
    const r = pickDay({ fields: getFields(), times, next }, day);
    next = r.next;
    write(r.fields);
    if (r.done) cal?.hide();
    else paint();
  };
  const panel = () => {
    const bar = document.createElement('div');
    bar.className = 'jstex-vc__panel';
    const timeField = (end: RangeEnd, label: string, placeholder: string) =>
      `<label><span>${escapeHtml(label)}</span><input type="text" data-vc-time="${end}" placeholder="${placeholder}" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(S.timeOf(label))}"></label>`;
    bar.innerHTML = `
      <div class="jstex-vc__hint"></div>
      <div class="jstex-vc__times">${timeField('from', S.from, '00:00')}${timeField('to', S.to, '23:59')}</div>
      <div class="jstex-vc__actions"><button type="button" data-vc-act="today">${escapeHtml(S.today)}</button><button type="button" data-vc-act="clear">${escapeHtml(S.clear)}</button><button type="button" data-vc-act="done">${escapeHtml(S.done)}</button></div>`;
    bar.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-vc-act]'
      )?.dataset.vcAct;
      if (act === 'today') pick(new Date().toISOString().slice(0, 10));
      else if (act === 'clear') {
        times = { from: '', to: '' };
        next = 'from';
        write({ from: '', to: '' });
        paint();
      } else if (act === 'done') cal?.hide();
    });
    const applyTime = (input: HTMLInputElement) => {
      const end = input.dataset.vcTime as RangeEnd;
      const time = normTime(input.value);
      input.classList.toggle('jstex-invalid', time === null);
      if (time === null) return;
      input.value = time;
      times = { ...times, [end]: time };
      write(setTime(getFields(), end, time));
    };
    bar.querySelectorAll<HTMLInputElement>('[data-vc-time]').forEach(input => {
      input.addEventListener('change', () => applyTime(input));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') applyTime(input);
      });
    });
    return bar;
  };

  const now = new Date();
  const options = (): ConstructorParameters<typeof Calendar>[1] => ({
    inputMode: true,
    positionToInput: 'auto',
    locale: languageCode().replace('_', '-'),
    selectedTheme: dark ? 'dark' : 'light',
    themeAttrDetect: '',
    // The range is ours (pickDay + data-jstex-range); the library only reports clicks.
    selectionDatesMode: 'single',
    enableDateToggle: false,
    onClickDate(_self, event) {
      const day = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-vc-date]'
      )?.dataset.vcDate;
      if (day) pick(day);
    },
    onCreateDateEls(_self, dateEl) {
      const f = getFields();
      paintDay(dateEl, dayOf(f.from), dayOf(f.to));
    },
    onShow(self) {
      main = self.context.mainElement;
      main.classList.add('jstex-vc');
      const styles = getComputedStyle(root);
      for (const name of POPUP_VARS)
        main.style.setProperty(name, styles.getPropertyValue(name));
      if (!main.querySelector('.jstex-vc__panel')) main.appendChild(panel());
      paint();
      const shown = main;
      requestAnimationFrame(() => reposition(block, shown));
      // The notebook scrolls inside its panel: close instead of floating away.
      onScroll = () => self.hide();
      window.addEventListener('scroll', onScroll, true);
    },
    onHide() {
      if (onScroll) window.removeEventListener('scroll', onScroll, true);
      onScroll = null;
    }
  });
  // Created on first open: in input mode set() throws until it has been shown.
  let cal: Calendar | null = null;
  let cleanup: (() => void) | undefined;

  return {
    open(end) {
      next = end;
      const f = getFields();
      times = { from: timeOf(f.from), to: timeOf(f.to) };
      // Show the month of the end being picked (else the other end, else today).
      const shown =
        dateInputToIso(f[end], end === 'to') ||
        dateInputToIso(f[end === 'to' ? 'from' : 'to'], end === 'from');
      const view = {
        selectedDates: [],
        selectedMonth: (shown
          ? Number(shown.slice(5, 7)) - 1
          : now.getUTCMonth()) as Range<12>,
        selectedYear: shown ? Number(shown.slice(0, 4)) : now.getUTCFullYear()
      };
      if (cal) cal.set(view);
      else {
        cal = new Calendar(anchor, { ...options(), ...view });
        cleanup = cal.init();
      }
      cal.show();
      paint();
    },
    destroy() {
      if (onScroll) window.removeEventListener('scroll', onScroll, true);
      cleanup?.();
      cal?.destroy();
    }
  };
}

/**
 * Re-apply the popup's vertical position with measured sizes, against the
 * whole From/To block so neither field is covered (the library can also read
 * offsetHeight before layout and overlap the input; from STEX).
 */
function reposition(block: HTMLElement, popup: HTMLElement): void {
  const position = popup.dataset.vcPosition;
  if (position !== 'top' && position !== 'bottom') return;
  const rect = block.getBoundingClientRect();
  popup.style.top = `${
    position === 'top'
      ? rect.top + window.scrollY - popup.offsetHeight
      : rect.bottom + window.scrollY
  }px`;
}
