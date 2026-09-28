"use client";
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase-client';
const labels:Record<string,string>={photo_checks_missing:'Серверная проверка фото ещё не получена',signals_missing:'Сигналы не получены',claim_time_unknown:'Время взятия задачи неизвестно',short_work_time:'Менее минуты после взятия задачи',camera_not_used:'Файл или неизвестный источник снимка',gps_missing_or_stale:'Нет свежих данных GPS',gps_imprecise:'Низкая точность GPS',gps_far:'GPS далеко от места обращения',photo_time_unknown_or_old:'Время снимка неизвестно или старше 15 минут',upload_not_fresh:'Загрузка старше 15 минут или время неизвестно',before_unavailable:'Исходное фото недоступно для сравнения',same_as_before:'Файл совпадает с исходным фото',photo_reused:'Файл уже использовался как доказательство'};
type Trust={distance_m:number|null;accuracy_m:number|null;elapsed_seconds:number|null;flags:string[];checked_at:string|null;photo_source:string;ai_status:string};
export function EvidenceTrust({id}:{id:string}){
 const [value,setValue]=useState<Trust|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let live=true;supabase.from('resolution_trust').select('distance_m,accuracy_m,elapsed_seconds,flags,checked_at,photo_source,ai_status').eq('resolution_id',id).maybeSingle().then(({data,error})=>{if(live){setValue(data);setError(!!error);}});return()=>{live=false;};},[id]);
 return <div className="rounded border p-3 text-sm space-y-1"><p className="font-medium">Сигналы доверия — не доказательство достоверности</p>
 {!value ? <p>{error?'Сигналы временно недоступны.':'Сигналы ещё не получены или для старых доказательств не собирались.'} Нужна ручная проверка.</p>:<>
 <p>Расстояние по GPS: {value.distance_m===null?'неизвестно':`${value.distance_m} м`} · Точность: {value.accuracy_m===null?'неизвестна':`±${value.accuracy_m} м`}</p>
 <p>От взятия задачи до доказательств: {value.elapsed_seconds===null?'неизвестно':`${Math.round(value.elapsed_seconds/60)} мин`}</p>
 <p>Источник: {value.photo_source==='camera'?'камера браузера (со слов устройства)':'файл / неизвестен'}. AI: {value.ai_status==='available'?'анализ получен':value.ai_status==='pending'?'ещё не получен':'недоступен'}.</p>
 <ul className="list-disc pl-5">{value.flags.map(flag=><li key={flag}>{labels[flag]||'Нужна ручная проверка'}</li>)}</ul>
 {!value.flags.length && <p>Явных расхождений не найдено. Независимая проверка всё равно обязательна.</p>}</>}
 <p className="text-xs text-muted-foreground">GPS, источник и время снимка могут быть неточными или подменёнными. Быстрая работа и неточный GPS сами по себе не означают нарушение.</p></div>;
}
export function RejectEvidence({disabled,onReject}:{disabled:boolean;onReject:(reason:string)=>void}){
 const [reason,setReason]=useState('');
 return <div className="space-y-2"><label className="block text-sm">Причина отклонения<textarea className="block w-full rounded border p-2" minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Что нужно исправить (без личных данных)"/></label><button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50" disabled={disabled||reason.trim().length<3} onClick={()=>onReject(reason.trim())}>Проблема не решена / Повторно открыть</button></div>;
}
