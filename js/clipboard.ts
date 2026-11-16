/**
 * Copy text that is still being fetched. Where ClipboardItem accepts a promise,
 * the write starts now, inside the click, so the browser still counts it as a
 * user action when the text arrives; elsewhere it copies once it is there.
 */
export async function copyTextLater(text: Promise<string>): Promise<boolean> {
  try {
    if (
      typeof ClipboardItem !== 'undefined' &&
      navigator.clipboard?.write &&
      window.isSecureContext
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': text.then(t => new Blob([t], { type: 'text/plain' }))
        })
      ]);
      return true;
    }
  } catch {
    // a failed fetch rejects `text`; the caller reports it
    await text;
    return copyText(await text);
  }
  return copyText(await text);
}

/** Copy text; falls back to execCommand where the async clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
