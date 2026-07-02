import type { ProfileFact, LlmSafeProfileFact } from '@/lib/sheetkiller/types';

const SENSITIVE_PATHS = /(id|身份证|phone|mobile|手机|email|邮箱|bank|银行卡)/i;

export function redactFactForLlm(fact: ProfileFact): LlmSafeProfileFact {
  if (fact.sensitive) {
    return {
      path: fact.path,
      label: fact.label,
      aliases: fact.aliases,
      sensitive: true,
      hasValue: Boolean(fact.value),
      provenance: fact.provenance,
    };
  }
  return {
    path: fact.path,
    label: fact.label,
    aliases: fact.aliases,
    sensitive: false,
    hasValue: Boolean(fact.value),
    value: fact.value,
    provenance: fact.provenance,
  };
}

export function redactFactsForLlm(facts: ProfileFact[]): LlmSafeProfileFact[] {
  return facts.map(redactFactForLlm);
}

export function factsFromRecord(
  record: Record<string, unknown>,
  provenance: ProfileFact['provenance'] = 'profile.json',
  prefix = '',
): ProfileFact[] {
  const facts: ProfileFact[] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          facts.push(...factsFromRecord(item as Record<string, unknown>, provenance, `${path}[${index}]`));
        } else if (item !== '') {
          facts.push({
            path: `${path}[${index}]`,
            label: key,
            value: String(item),
            aliases: [key],
            sensitive: SENSITIVE_PATHS.test(path),
            provenance,
          });
        }
      });
      continue;
    }
    if (typeof value === 'object') {
      facts.push(...factsFromRecord(value as Record<string, unknown>, provenance, path));
      continue;
    }
    facts.push({
      path,
      label: key,
      value: String(value),
      aliases: [key],
      sensitive: SENSITIVE_PATHS.test(path),
      provenance,
    });
  }
  return facts;
}

export function resolveFactValue(facts: ProfileFact[], path: string): string {
  return facts.find((fact) => fact.path === path)?.value ?? '';
}

