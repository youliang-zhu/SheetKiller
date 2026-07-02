const FINAL_SUBMIT_PATTERNS = [
  /\bsubmit\b/i,
  /confirm\s+submit/i,
  /send\s+application/i,
  /\bapply\s+now\b/i,
  /提交/,
  /确认提交/,
  /最终提交/,
  /投递/,
  /确认投递/,
];

export function isFinalSubmitElement(el: Element): boolean {
  const text = [
    el.textContent ?? '',
    el.getAttribute('value') ?? '',
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
    el.getAttribute('name') ?? '',
    el.getAttribute('id') ?? '',
  ].join(' ');
  const type = (el as HTMLInputElement).type?.toLowerCase?.() ?? '';
  if (type === 'submit') return true;
  return FINAL_SUBMIT_PATTERNS.some((pattern) => pattern.test(text));
}

export function installTemporarySubmitGuard(doc: Document = document): () => void {
  const listener = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button, input, [role="button"], a');
    if (!button) return;
    if (!isFinalSubmitElement(button)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  doc.addEventListener('click', listener, true);
  doc.addEventListener('submit', listener, true);
  return () => {
    doc.removeEventListener('click', listener, true);
    doc.removeEventListener('submit', listener, true);
  };
}

