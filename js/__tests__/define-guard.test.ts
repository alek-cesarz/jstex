import { describe, expect, it } from 'vitest';
import '../define-guard';

describe('define-guard', () => {
  it('makes re-defining a registered tag a no-op instead of throwing', () => {
    class A extends HTMLElement {}
    class B extends HTMLElement {}
    customElements.define('jstex-guard-test', A);
    expect(() => customElements.define('jstex-guard-test', B)).not.toThrow();
    expect(customElements.get('jstex-guard-test')).toBe(A);
  });
});
