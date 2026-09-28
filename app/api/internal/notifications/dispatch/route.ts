import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {advisoryDatabase} from '@/lib/server/authorization';
import {dispatchExternal} from '@/lib/messaging/external-delivery';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:NextRequest){
 const secret=process.env.CRON_SECRET;
 const supplied=request.headers.get('authorization')||'';
 if(!secret||secret.length<32)return NextResponse.json({error:'Worker not configured'},{status:503});
 const expected=`Bearer ${secret}`;
 if(Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});
 const db=advisoryDatabase();if(!db)return NextResponse.json({error:'Worker not configured'},{status:503});
 try {return NextResponse.json(await dispatchExternal(db),{headers:{'Cache-Control':'no-store'}});}
 catch {console.error('[external_delivery]',{code:'WORKER_FAILED'});return NextResponse.json({error:'Worker failed; queue retained'},{status:503});}
}
