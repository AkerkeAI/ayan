import { GoogleGenerativeAIAbortError } from '@google/generative-ai';
// Only allowlisted metadata is logged. Never log SDK messages, URLs, payloads or credentials.
export type Stage = 'environment' | 'claim' | 'catalog' | 'image' | 'gemini' | 'validation' | 'persist' | 'complete';
export type Diagnostic = { stage: Stage; status: 'started' | 'ok' | 'failed' | 'skipped'; code?: string; httpStatus?: number };
export type Reporter = (event: Diagnostic) => void;
const providerReasons = new Set(['ACCESS_TOKEN_TYPE_UNSUPPORTED', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_EXPIRED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'SERVICE_DISABLED', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED']);
export function safeError(error: unknown): { code: string; httpStatus?: number } {
  const e = error as { status?: unknown; code?: unknown; name?: unknown; errorDetails?: { reason?: unknown }[] } | null;
  const httpStatus = typeof e?.status === 'number' && e.status >= 400 && e.status <= 599 ? e.status : undefined;
  const details = e?.errorDetails;
  const reason = Array.isArray(details) ? details.find(d => typeof d?.reason === 'string' && providerReasons.has(d.reason))?.reason : undefined;
  const databaseCode = typeof e?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(e.code) ? e.code : undefined;
  return { code: typeof reason === 'string' ? reason : databaseCode ?? (error instanceof GoogleGenerativeAIAbortError || e?.name === 'AbortError' || e?.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED'), ...(httpStatus ? { httpStatus } : {}) };
}
export function reporter(reportId?: string): Reporter {
  return event => {
    const safeId = reportId && /^[0-9a-f-]{36}$/i.test(reportId) ? reportId : undefined;
    const entry = { feature: 'category_discovery', reportId: safeId, ...event };
    if (event.status === 'failed') console.error('[category_discovery]', entry);
    else console.info('[category_discovery]', entry);
  };
}
