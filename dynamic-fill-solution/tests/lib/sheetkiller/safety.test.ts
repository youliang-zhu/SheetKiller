import { describe, expect, it } from 'vitest';
import { installTemporarySubmitGuard, isFinalSubmitElement } from '@/lib/sheetkiller/safety/submit-guard';

describe('SheetKiller submit guard', () => {
  it('recognizes final submit-like buttons', () => {
    const button = document.createElement('button');
    button.textContent = '确认提交';
    expect(isFinalSubmitElement(button)).toBe(true);
  });

  it('prevents guarded click events', () => {
    const cleanup = installTemporarySubmitGuard(document);
    const button = document.createElement('button');
    button.textContent = 'Submit';
    document.body.appendChild(button);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);
    cleanup();

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
});

