/**
 * Must be the FIRST import of widget.ts.
 *
 * anywidget evaluates the bundle again for every new widget model (each
 * `Explorer()` gets a fresh blob URL), and the bundled @eox/* modules call
 * customElements.define() at load time. A second definition of the same tag
 * throws and kills the new widget. Make re-definition of an already
 * registered tag a no-op; first definitions are untouched.
 */
type Registry = CustomElementRegistry & { __jstexDefineGuard?: true };

const registry = window.customElements as Registry;
if (!registry.__jstexDefineGuard) {
  const define = registry.define.bind(registry);
  registry.define = (name, constructor, options) => {
    if (!registry.get(name)) define(name, constructor, options);
  };
  registry.__jstexDefineGuard = true;
}

export {};
