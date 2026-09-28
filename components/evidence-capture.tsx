"use client";
import {useEffect,useRef,useState} from 'react';
import type {CaptureInfo} from '@/lib/resolutions/capture';
export function EvidenceCapture({onChange,disabled}:{onChange:(file:File|null,info:CaptureInfo)=>void;disabled:boolean}) {
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),selected=useRef<File|null>(null);
 const mounted=useRef(true);
 const info=useRef<CaptureInfo>({source:'unknown'});
 const [camera,setCamera]=useState(false),[message,setMessage]=useState('');
 function stop(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false);}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stream.current?.getTracks().forEach(t=>t.stop());};},[]);
 async function openCamera(){
  try {stop(); const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});if(!mounted.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;setCamera(true);
   if(video.current){video.current.srcObject=media;await video.current.play();}setMessage('');
  }catch{stop();setMessage('Камера недоступна. Можно выбрать файл — его проверит оператор Aýan.');}
 }
 function select(file:File|null,source:CaptureInfo['source']){selected.current=file;info.current={...info.current,source,photoTime:file?.lastModified};onChange(file,info.current);setMessage(file?'Фото выбрано':'');}
 async function take(){
  const v=video.current;if(!v?.videoWidth)return;
  const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d')?.drawImage(v,0,0);
  const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,'image/jpeg',0.9));
  if(blob){select(new File([blob],'camera.jpg',{type:'image/jpeg',lastModified:Date.now()}),'camera');stop();}
 }
 return <div className="space-y-2 rounded border p-3">
  <p className="text-sm">Сделайте новое фото после работ. Если камера недоступна, выберите файл.</p>
  <button type="button" disabled={disabled} className="rounded border px-3 py-2" onClick={()=>void openCamera()}>Открыть камеру</button>
  <video ref={video} autoPlay muted playsInline className={camera?'max-h-72 w-full':'hidden'}/>
  {camera && <div className="flex gap-2"><button type="button" disabled={disabled} onClick={()=>void take()}>Сделать снимок</button><button type="button" onClick={stop}>Закрыть камеру</button></div>}
  <label className="block text-sm">Или выбрать фото (JPEG, PNG, WebP, до 5 МБ)<input disabled={disabled} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{stop();select(e.target.files?.[0]||null,'file');}}/></label>
  <p className="text-xs text-muted-foreground">При отправке потребуется доступ к текущему местоположению. Без него решение не отправится. Сохраняются только расстояние и точность, без точных координат. Фото публикуется без метаданных геолокации.</p>
  {message && <p role="status" className="text-sm">{message}</p>}
 </div>;
}
