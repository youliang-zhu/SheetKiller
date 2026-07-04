import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard AI profile completion routing', () => {
  it('routes AI profile completion through the background message handler first', () => {
    const source = readFileSync(
      join(process.cwd(), 'entrypoints', 'dashboard', 'App.tsx'),
      'utf8',
    );

    const messageIndex = source.indexOf("type: 'AI_COMPLETE_PROFILE'");
    const directFetchIndex = source.indexOf('completeProfileWithAi(');

    expect(messageIndex).toBeGreaterThan(-1);
    expect(directFetchIndex).toBeGreaterThan(-1);
    expect(messageIndex).toBeLessThan(directFetchIndex);
  });
});
