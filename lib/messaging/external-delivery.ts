// Server-only module: imported exclusively by the authenticated delivery worker.
export type DeliveryJob={id:string;report_id:string;organization_id:string;event_type:string;channel:string;destination:string;category_name:string;address:string;description:string;reason:string|null;created_at:string;lease_token:string;request_payload:MailPayload|null};
export type MailPayload={from:string;to:string[];subject:string;text:string};
export type DeliveryResult={status:'sent'|'retry'|'blocked';code:string;providerId?:string};
const email=/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
export function safeExcerpt(value:string,max:number){
 // Omit explicit credentials and opaque tokens from untrusted report/review text.
 return value.replace(/(?:password|passwd|пароль|api[ _-]?key|ключ[ _-]?api|authorization|bearer|token|токен|secret|секрет)\s*[:=]?\s*\S+/gi,'[скрыто]')
  .replace(/https?:\/\/[^\s]+/gi,'[ссылка скрыта]').replace(/[A-Za-z0-9_+/=-]{32,}/g,'[скрыто]')
  .replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function prepareDelivery(job:DeliveryJob):{payload:MailPayload}|{error:string}{
 if(job.channel!=='email')return{error:'UNSUPPORTED_CHANNEL'};
 if(!process.env.RESEND_API_KEY)return{error:'PROVIDER_NOT_CONFIGURED'};
 if(job.request_payload)return{payload:job.request_payload}; // Keep exact request bytes stable across retries/config changes.
 const from=process.env.RESEND_FROM_EMAIL||'';
 if(!email.test(from)||!email.test(job.destination))return{error:'INVALID_EMAIL_CONFIGURATION'};
 let origin:string;
 try {const url=new URL(process.env.AYAN_SITE_URL||'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();origin=url.origin;}catch{return{error:'SITE_URL_NOT_CONFIGURED'};}
 const titles:Record<string,string>={task_available:'Новая задача доступна',claim_released:'Задача снова доступна',claimed_elsewhere:'Задачу взяла другая организация',evidence_rejected:'Решение не подтверждено',resolution_verified:'Решение подтверждено. Спасибо за выполненную работу!'};
 if(!titles[job.event_type])return{error:'UNSUPPORTED_EVENT'};
 const title=titles[job.event_type];
 const text=[`Aýan — уведомление: ${title}.`,`Событие: ${new Date(job.created_at).toISOString()}`,`ID задачи: ${job.report_id}`,`Категория: ${safeExcerpt(job.category_name,80)}`,`Адрес: ${safeExcerpt(job.address,200)}`,`Описание: ${safeExcerpt(job.description,350)}`,
  ...(job.reason?[`Причина: ${safeExcerpt(job.reason,500)}`]:[]),
  ...(job.event_type==='claimed_elsewhere'?['Действия по этому уведомлению не требуются.']:[]),
  'Это уведомление о событии, не отдельная жалоба. Текущий статус и доступные действия — в карточке задачи.',
  `${origin}/dashboard/reports/${job.report_id}`].join('\n');
 return {payload:{from,to:[job.destination],subject:`Aýan: ${title} · ${job.report_id.slice(0,8)}`,text}};
}
export async function sendEmail(id:string,payload:MailPayload):Promise<DeliveryResult>{
 try {
  const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`ayan-notification/${id}`},body:JSON.stringify({from:payload.from,to:payload.to,subject:payload.subject,text:payload.text})});
  if(response.status===429||response.status>=500)return{status:'retry',code:`RESEND_${response.status}`};
  if(!response.ok)return{status:'blocked',code:`RESEND_${response.status}`};
  const data=await response.json();
  if(typeof data?.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.id))return{status:'retry',code:'INVALID_PROVIDER_CONFIRMATION'};
  return{status:'sent',code:'PROVIDER_ACCEPTED',providerId:data.id.toLowerCase()};
 }catch{return{status:'retry',code:'PROVIDER_OUTCOME_UNKNOWN'};}
}
export async function dispatchExternal(db:{rpc:Function},limit=3){
 let processed=0;
 for(let i=0;i<limit;i++){
  const claim=await db.rpc('claim_external_notification');if(claim.error)throw Error('QUEUE_UNAVAILABLE');
  const job=claim.data?.[0] as DeliveryJob|undefined;if(!job)break;
  const prepared=prepareDelivery(job);let outcome:DeliveryResult;
  if('error' in prepared)outcome={status:'blocked',code:prepared.error};
  else {
   const begin=await db.rpc('begin_external_attempt',{p_id:job.id,p_lease:job.lease_token,p_payload:prepared.payload});
   if(begin.error){console.error('[external_delivery]',{id:job.id,code:'ATTEMPT_NOT_STARTED'});continue;}
   outcome=await sendEmail(job.id,prepared.payload);
  }
  const finish=await db.rpc('finish_external_notification',{p_id:job.id,p_lease:job.lease_token,p_status:outcome.status,p_code:outcome.code,p_provider_id:outcome.providerId||null});
  // A failed acknowledgement leaves the lease for recovery with the SAME idempotency key/payload.
  console[outcome.status==='sent'&&!finish.error?'info':'error']('[external_delivery]',{id:job.id,status:finish.error?'unconfirmed':outcome.status,code:finish.error?'ACK_FAILED':outcome.code});
  if(finish.error)throw Error('ACK_FAILED');
  processed++;
 }
 return {processed};
}
