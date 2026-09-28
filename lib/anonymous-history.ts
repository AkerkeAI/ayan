// Browser-only history receipts, never an authorization credential.
// Kept separate from the +1 supporter token. No token is sent to the database.
const OWNER_KEY = 'ayan_history_owner';
const PREFIX = 'ayan_created_report:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let memoryOwner: string | null = null;
let memoryReports = new Set<string>();
function useOwner(owner: string) {
  if (memoryOwner !== owner) { memoryOwner = owner; memoryReports = new Set(); }
  return owner;
}
export function anonymousHistoryOwner(): string {
  if (typeof window === 'undefined') throw Error('Anonymous history is browser-only');
  try {
    const existing = window.localStorage.getItem(OWNER_KEY);
    if (existing && UUID.test(existing)) return useOwner(existing);
    const owner = crypto.randomUUID();
    window.localStorage.setItem(OWNER_KEY, owner);
    return useOwner(owner);
  } catch {
    // Storage denial must not turn a successful report submission into a failure.
    return memoryOwner ?? useOwner(crypto.randomUUID());
  }
}
export function rememberCreatedReport(reportId: string): void {
  if (!UUID.test(reportId)) return;
  const owner = anonymousHistoryOwner();
  memoryReports.add(reportId);
  try { window.localStorage.setItem(`${PREFIX}${owner}:${reportId}`, '1'); } catch { /* session-only fallback */ }
}
export function ownedReportIds(): string[] {
  const owner = anonymousHistoryOwner();
  const prefix = `${PREFIX}${owner}:`;
  try {
    const ids = new Set(memoryReports);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix) && UUID.test(key.slice(prefix.length))) ids.add(key.slice(prefix.length));
    }
    memoryReports = ids;
  } catch { /* keep this session's receipts when storage is blocked */ }
  return Array.from(memoryReports);
}
