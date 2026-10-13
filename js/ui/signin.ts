/**
 * Panel-footer sign-in (spec 2026-10-02 §4.1): status line with Sign in /
 * Sign out, and an inline area for the device code, the client-id field, the
 * password form and errors. The password goes straight to the kernel.
 */
import type { Actions } from '../actions';
import { escapeHtml } from '../format';
import type { Store } from '../store';
import { S } from '../strings';
import type { ExplorerState, LoginState } from '../types';

type SigninActions = Pick<
  Actions,
  'startLogin' | 'submitPassword' | 'cancelLogin' | 'logout'
>;

const SIGN_OUT_SOURCES = new Set(['token', 'session', 'device', 'password']);

export function isInsecure(loc: {
  protocol: string;
  hostname: string;
}): boolean {
  return (
    loc.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname)
  );
}

function btn(ref: string, label: string, primary = false): string {
  return `<button type="button" class="jstex-control${primary ? ' jstex-primary' : ''}" data-ref="${ref}">${escapeHtml(label)}</button>`;
}

function boxHtml(login: LoginState, methods: string[]): string {
  switch (login.state) {
    case 'starting':
      return `<p>${escapeHtml(S.signingIn)}</p><div class="jstex-row">${btn('cancelLogin', S.cancel)}</div>`;
    case 'need_client_id':
      return `<label class="jstex-signin__label">${escapeHtml(S.clientIdLabel)}
          <input type="text" class="jstex-control" data-ref="clientId" autocomplete="off" spellcheck="false"></label>
        <p class="jstex-hint">${escapeHtml(S.clientIdHint)}</p>
        <div class="jstex-row">${btn('continue', S.continueBtn, true)}${
          methods.includes('password') ? btn('usePassword', S.usePassword) : ''
        }${btn('cancelLogin', S.cancel)}</div>`;
    case 'device':
      return `<p>${escapeHtml(S.deviceStep)}</p>
        <div class="jstex-signin__code jstex-mono" data-ref="code">${escapeHtml(login.code)}</div>
        <div class="jstex-row">
          <a class="jstex-control jstex-primary" data-ref="open" href="${escapeHtml(login.uri)}" target="_blank" rel="noopener">${escapeHtml(S.openSignIn)}</a>
          ${btn('cancelLogin', S.cancel)}
        </div>
        <p class="jstex-hint" data-ref="countdown"></p>`;
    case 'password':
      return `<form data-ref="passwordForm" class="jstex-signin__form">
          <label class="jstex-signin__label">${escapeHtml(S.username)}
            <input type="text" class="jstex-control" data-ref="username" autocomplete="username"></label>
          <label class="jstex-signin__label">${escapeHtml(S.password)}
            <input type="password" class="jstex-control" data-ref="password" autocomplete="current-password"></label>
          ${isInsecure(window.location) ? `<p class="jstex-hint jstex-hint--warn">${escapeHtml(S.insecurePassword)}</p>` : ''}
          <div class="jstex-row">${btn('submitPassword', S.signIn, true)}${btn('cancelLogin', S.cancel)}</div>
        </form>`;
    case 'error':
      return `<p class="jstex-hint jstex-hint--err" role="alert">${escapeHtml(login.message)}</p>
        <div class="jstex-row">${
          login.next === 'password'
            ? btn('usePassword', S.usePassword, true)
            : login.next === 'client_id'
              ? btn('enterClientId', S.enterClientId, true)
              : btn('tryAgain', S.tryAgain, true)
        }${btn('cancelLogin', S.close)}</div>`;
    default:
      return '';
  }
}

export function mountSignin(
  el: HTMLElement,
  store: Store<ExplorerState>,
  actions: SigninActions
): () => void {
  el.innerHTML = `
    <div class="jstex-signin">
      <div class="jstex-hint jstex-hint--icon jstex-signin__status" data-ref="auth">
        <span data-ref="statusText"></span>
        <button type="button" class="jstex-link" data-ref="signIn">${escapeHtml(S.signIn)}</button>
        <button type="button" class="jstex-link" data-ref="signOut">${escapeHtml(S.signOut)}</button>
      </div>
      <div class="jstex-signin__box" data-ref="box" hidden></div>
    </div>`;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) =>
    el.querySelector(`[data-ref="${name}"]`) as T;
  const box = ref('box');
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    const login = store.get().login;
    const out = box.querySelector<HTMLElement>('[data-ref="countdown"]');
    if (login.state !== 'device' || !out) return;
    const left = Math.max(0, Math.round((login.expiresAt - Date.now()) / 1000));
    out.textContent = S.expiresIn(Math.floor(left / 60), left % 60);
  };

  const renderStatus = (s: ExplorerState) => {
    const anonymous = s.authSource === 'anonymous';
    const how = S.authLabels[s.authSource] ?? s.authSource;
    const status = ref('statusText');
    status.textContent = anonymous
      ? S.anonymousNote
      : s.authUser
        ? S.signedInAs(how, s.authUser)
        : S.signedInVia(how);
    status.title = s.profileName ? S.profileTitle(s.profileName) : '';
    ref('auth').hidden = s.collectionsLoading;
    ref('signIn').hidden =
      !anonymous || !s.loginMethods.length || s.login.state !== 'idle';
    ref('signOut').hidden = !SIGN_OUT_SOURCES.has(s.authSource);
  };

  const renderBox = (s: ExplorerState) => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    box.innerHTML = boxHtml(s.login, s.loginMethods);
    box.hidden = s.login.state === 'idle';
    if (s.login.state === 'device') {
      tick();
      timer = setInterval(tick, 1000);
    }
  };

  el.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-ref]');
    const methods = store.get().loginMethods;
    switch (target?.dataset.ref) {
      case 'signIn':
        actions.startLogin(methods.includes('device') ? 'device' : 'password');
        break;
      case 'signOut':
        actions.logout();
        break;
      case 'continue': {
        const id = (
          box.querySelector('[data-ref="clientId"]') as HTMLInputElement
        ).value.trim();
        if (id) actions.startLogin('device', id);
        break;
      }
      case 'usePassword':
        actions.startLogin('password');
        break;
      case 'enterClientId':
        store.set({ login: { state: 'need_client_id' } });
        break;
      case 'tryAgain':
        actions.startLogin('device');
        break;
      case 'submitPassword': {
        e.preventDefault();
        const user = box.querySelector(
          '[data-ref="username"]'
        ) as HTMLInputElement;
        const pass = box.querySelector(
          '[data-ref="password"]'
        ) as HTMLInputElement;
        actions.submitPassword(user.value.trim(), pass.value);
        pass.value = '';
        break;
      }
      case 'cancelLogin':
        actions.cancelLogin();
        break;
    }
  });
  box.addEventListener('submit', e => e.preventDefault());

  renderStatus(store.get());
  renderBox(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (
      s.authSource !== prev.authSource ||
      s.authUser !== prev.authUser ||
      s.profileName !== prev.profileName ||
      s.loginMethods !== prev.loginMethods ||
      s.collectionsLoading !== prev.collectionsLoading ||
      s.login !== prev.login
    )
      renderStatus(s);
    if (s.login !== prev.login) renderBox(s);
  });
  return () => {
    if (timer !== undefined) clearInterval(timer);
    unsubscribe();
  };
}
