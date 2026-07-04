import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentPath = resolve(process.cwd(), 'entrypoints/content.ts');

describe('content script SheetKiller messaging', () => {
  it('registers scan listener before the form-element activation gate', () => {
    const source = readFileSync(contentPath, 'utf8');
    const listenerRegistration = source.indexOf('registerSheetKillerDynamicListener()');
    const formGate = source.indexOf('if (!hasFormElements) return;');

    expect(listenerRegistration).toBeGreaterThanOrEqual(0);
    expect(formGate).toBeGreaterThanOrEqual(0);
    expect(listenerRegistration).toBeLessThan(formGate);
  });
});
