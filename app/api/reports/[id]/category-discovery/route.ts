import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { processOtherCategory } from '@/lib/category-discovery/process';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Only the new-report form calls this POST. Viewing reports never starts AI.
// The database permits one attempt, only for a newly created other report with a photo.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) return NextResponse.json({ error: 'Некорректный ID' }, { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Запрос запрещён' }, { status: 403 });
  const status = await processOtherCategory(params.id);
  // This is separate from report creation: failure must never undo the saved report.
  return NextResponse.json({ success: status !== 'failed', classification: status === 'failed' ? 'unavailable' : status }, { status: status === 'failed' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
