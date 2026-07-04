import { describe, expect, it, vi } from 'vitest';
import { completeProfileWithAi } from '@/lib/import/ai-profile-completer';
import type { Settings } from '@/lib/storage/types';

const settings: Settings = {
  toolbarPosition: { x: 16, y: 80 },
  apiKey: 'test-key',
  apiProvider: 'openai',
  apiBaseUrl: '',
  apiModel: '',
  skipSensitive: true,
  allowedDomains: [],
};

describe('AI profile completer', () => {
  it('turns fetch network errors into actionable provider connection errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(completeProfileWithAi(
      'resume text',
      settings,
      { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
      fetchImpl,
    )).rejects.toThrow('无法连接 AI 供应商接口');
  });

  it('parses JSON content from chat completions responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            basic: { name: '朱有亮' },
            education: [],
          }),
        },
      }],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await completeProfileWithAi(
      '朱有亮 resume text',
      settings,
      { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
      fetchImpl,
    );

    expect(result.basic?.name).toBe('朱有亮');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('normalizes copied base URLs before requesting the provider', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ basic: { name: '朱有亮' } }),
        },
      }],
    }), { status: 200 })) as unknown as typeof fetch;

    await completeProfileWithAi(
      'resume text',
      {
        ...settings,
        apiBaseUrl: ' https://api.openai.com/v1/chat/completions/ ',
        apiKey: ' test-key ',
        apiModel: ' gpt-5.5 ',
      },
      { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5' },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });
});
