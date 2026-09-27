export type ResolutionState = 'pending'|'ai_checked'|'needs_review'|'resident_confirmed'|'verified'|'reopened';
export interface Resolution {
  id: string;
  report_id: string;
  note: string;
  after_photo_path: string;
  submitted_at: string;
  submitted_by: string | null;
  reviewed_at: string | null;
  state: ResolutionState;
  ai_result: null | {likely_resolved:boolean; confidence:number; observations:string[]; requires_human_review:boolean};
}
export const resolutionLabels: Record<ResolutionState,string> = {
  pending:'На проверке — ожидает проверки оператором Aýan',
  ai_checked:'Фото проанализированы — ожидает проверки оператором Aýan',
  needs_review:'Требуется дополнительная проверка',
  resident_confirmed:'Житель сообщил об устранении — ожидает проверки оператором Aýan',
  verified:'Решение подтверждено независимым проверяющим',
  reopened:'Повторно открыто',
};
export function resolutionLabel(r: Pick<Resolution,'state'|'reviewed_at'>) {
  return r.state==='verified' && !r.reviewed_at
    ? 'Решено ранее — независимая проверка не зафиксирована'
    : resolutionLabels[r.state];
}

// Presentation only: preserve the existing AI result and human-review decisions.
export function resolutionReviewMessage(ai: Resolution['ai_result']) {
  const unavailable = !ai || (ai.confidence===0 && !ai.likely_resolved && ai.observations.length===1 && ai.observations[0]==='Изменение не удалось подтвердить по фото. Требуется дополнительная проверка.');
  if(unavailable)return 'Автоматическая проверка недоступна. Решение проверит оператор Aýan.';
  if(!ai.likely_resolved || ai.requires_human_review)return 'AI не смог уверенно подтвердить результат. Требуется проверка оператора Aýan.';
  return 'AI считает, что проблема устранена. Окончательное подтверждение — оператором Aýan.';
}
