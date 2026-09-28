import { advisoryDatabase } from '@/lib/server/authorization';
import { discoverCategory } from './ai';
import { reporter, safeError, type Stage } from './diagnostics';
export type DiscoveryStatus = 'completed' | 'skipped' | 'failed';
// Claims remain atomic, one-time, and limited to new reports by migration 00015.
export async function processOtherCategory(reportId: string): Promise<DiscoveryStatus> {
  const trace = reporter(reportId);
  let stage: Stage = 'environment';
  try {
    const db = advisoryDatabase();
    if (!db) { trace({ stage, status: 'failed', code: 'SERVICE_KEY_MISSING' }); return 'failed'; }
    stage = 'claim'; trace({ stage, status: 'started' });
    const { data: claim, error } = await db.rpc('claim_category_discovery', { p_report_id: reportId });
    if (error) { trace({ stage, status: 'failed', ...safeError(error) }); return 'failed'; }
    if (!claim) { trace({ stage, status: 'skipped', code: 'NOT_ELIGIBLE_OR_ALREADY_CLAIMED' }); return 'skipped'; }
    trace({ stage, status: 'ok' });
    let result = null;
    try {
      stage = 'catalog';
      const { data: categories, error: catalogError } = await db.from('category_catalog').select('key,name').eq('active', true).neq('key', 'other');
      if (catalogError) trace({ stage, status: 'failed', ...safeError(catalogError) });
      else if (!categories?.length) trace({ stage, status: 'failed', code: 'CATALOG_EMPTY' });
      else {
        trace({ stage, status: 'ok' });
        result = await discoverCategory(claim.description, claim.photo_url, categories, trace);
      }
    } catch (error) { trace({ stage, status: 'failed', ...safeError(error) }); }
    stage = 'persist';
    const { error: saveError } = await db.rpc('finish_category_discovery', { p_report_id: reportId, p_result: result });
    if (saveError) { trace({ stage, status: 'failed', ...safeError(saveError) }); return 'failed'; }
    trace({ stage, status: 'ok' });
    trace({ stage: 'complete', status: result ? 'ok' : 'failed', code: result ? 'RESULT_SAVED' : 'FAILURE_SAVED' });
    return result ? 'completed' : 'failed';
  } catch (error) { trace({ stage, status: 'failed', ...safeError(error) }); return 'failed'; }
}
