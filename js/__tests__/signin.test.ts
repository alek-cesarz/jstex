import { describe, expect, it, vi } from 'vitest';
import { applyLogin } from '../model-sync';
import { isInsecure, mountSignin } from '../ui/signin';
import { byRef as q, setupView } from './helpers';

function view(values: Record<string, unknown> = {}) {
  const v = setupView({
    login_methods: ['device', 'password'],
    profile_name: 'cdse-opensearch',
    ...values
  });
  mountSignin(v.el, v.store, v.actions);
  v.store.set({ collectionsLoading: false });
  return v;
}

describe('sign-in area', () => {
  it('offers Sign in when anonymous and starts device login', () => {
    const { el, store, backend } = view();
    expect(q(el, 'statusText').textContent).toBe(
      'Not signed in — restricted collections are hidden.'
    );
    q(el, 'signIn').click();
    expect(backend.startLogin).toHaveBeenCalledWith('device', undefined);
    expect(store.get().login.state).toBe('starting');
    expect(q(el, 'box').textContent).toContain('Signing in…');
  });

  it('asks for a client id when none is configured', () => {
    const { el, store, backend } = view();
    applyLogin(store, { type: 'login', state: 'need_client_id' }, vi.fn());
    (q(el, 'clientId') as HTMLInputElement).value = 'dev-client';
    q(el, 'continue').click();
    expect(backend.startLogin).toHaveBeenLastCalledWith('device', 'dev-client');
  });

  it('shows the device code with link and countdown; Cancel stops it', () => {
    const { el, store, backend } = view();
    applyLogin(
      store,
      {
        type: 'login',
        state: 'device',
        uri: 'https://id/device?c=1',
        code: 'ABCD-EFGH',
        expires_in: 600
      },
      vi.fn()
    );
    expect(q(el, 'code').textContent).toBe('ABCD-EFGH');
    expect((q(el, 'open') as HTMLAnchorElement).href).toBe(
      'https://id/device?c=1'
    );
    expect(q(el, 'countdown').textContent).toMatch(
      /^Code valid for (10:00|9:5\d)$/
    );
    q(el, 'cancelLogin').click();
    expect(backend.cancelLogin).toHaveBeenCalled();
    expect(store.get().login.state).toBe('idle');
  });

  it('password form submits and clears the password field', () => {
    const { el, store, backend } = view();
    applyLogin(store, { type: 'login', state: 'password' }, vi.fn());
    (q(el, 'username') as HTMLInputElement).value = 'alice';
    (q(el, 'password') as HTMLInputElement).value = 'pw';
    q(el, 'submitPassword').click();
    expect(backend.submitPassword).toHaveBeenCalledWith('alice', 'pw');
    expect(JSON.stringify(store.get())).not.toContain('"pw"');
  });

  it('a refused device client offers the password path', () => {
    const { el, store, backend } = view();
    applyLogin(
      store,
      {
        type: 'login',
        state: 'error',
        message: 'Client x is not allowed.',
        next: 'password'
      },
      vi.fn()
    );
    expect(q(el, 'box').textContent).toContain('Client x is not allowed.');
    q(el, 'usePassword').click();
    expect(backend.startLogin).toHaveBeenLastCalledWith('password', undefined);
  });

  it('signed in: status with user and profile, Sign out', () => {
    const { el, store, backend } = view();
    store.set({ authSource: 'device', authUser: 'alice' });
    expect(q(el, 'statusText').textContent).toBe(
      'Signed in (device login) as alice'
    );
    expect(q(el, 'statusText').title).toBe('Profile: cdse-opensearch');
    expect(q(el, 'signIn').hidden).toBe(true);
    q(el, 'signOut').click();
    expect(backend.logout).toHaveBeenCalled();
    store.set({ authSource: 'hub', authUser: 'alice' });
    expect(q(el, 'signOut').hidden).toBe(true); // the hub would sign the user in again
  });

  it('done reloads collections; insecure pages are detected', () => {
    const { store } = view();
    const reload = vi.fn();
    applyLogin(store, { type: 'login', state: 'done' }, reload);
    expect(reload).toHaveBeenCalled();
    expect(store.get().login.state).toBe('idle');
    expect(isInsecure({ protocol: 'http:', hostname: 'dev.example.org' })).toBe(
      true
    );
    expect(isInsecure({ protocol: 'http:', hostname: 'localhost' })).toBe(
      false
    );
    expect(
      isInsecure({ protocol: 'https:', hostname: 'dev.example.org' })
    ).toBe(false);
  });
});
