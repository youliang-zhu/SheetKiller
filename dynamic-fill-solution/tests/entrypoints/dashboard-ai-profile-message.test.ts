import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dashboard AI profile completion routing', () => {
  it('routes AI profile completion only through the background message handler', () => {
    const source = readFileSync(
      join(process.cwd(), 'entrypoints', 'dashboard', 'App.tsx'),
      'utf8',
    );

    const messageIndex = source.indexOf("type: 'AI_COMPLETE_PROFILE'");

    expect(messageIndex).toBeGreaterThan(-1);
    expect(source).not.toContain('completeProfileWithAi(');
    expect(source).not.toContain('mergeAiProfileCompletion(');
  });
});
