// Current device location is required for NEW evidence, never treated as proof of presence.
export type CaptureInfo = { source: 'camera'|'file'|'unknown'; photoTime?: number };
export const GPS_REQUIRED='Не удалось получить текущее местоположение. Разрешите доступ к геолокации в браузере и на устройстве, затем повторите отправку.';
export async function currentEvidenceSignals(info: CaptureInfo) {
 if (!navigator.geolocation) throw Error(GPS_REQUIRED);
 const gps=await new Promise<{latitude:number;longitude:number;accuracy:number;timestamp:number}>((resolve,reject)=>{
  let settled=false;
  const timer=setTimeout(()=>{settled=true;reject(Error(GPS_REQUIRED));},12000);
  const fail=()=>{clearTimeout(timer);if(!settled){settled=true;reject(Error(GPS_REQUIRED));}};
  try {navigator.geolocation.getCurrentPosition(p=>{
   if(settled)return;
   const g={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};
   if(!Object.values(g).every(Number.isFinite)||Math.abs(g.latitude)>90||Math.abs(g.longitude)>180||g.accuracy<0||g.timestamp<Date.now()-120000||g.timestamp>Date.now()+30000){fail();return;}
   clearTimeout(timer);settled=true;resolve(g);
  },fail,{enableHighAccuracy:true,maximumAge:0,timeout:10000});}catch{fail();}
 });
 return {source:info.source,photoTime:info.photoTime,gps};
}
// Re-encode before upload: GPS/EXIF metadata from gallery files is not published.
export async function stripPhotoMetadata(file: File): Promise<File> {
 let close=()=>{};
 let image:ImageBitmap|HTMLImageElement;
 if(typeof createImageBitmap==='function'){
  const bitmap=await createImageBitmap(file);image=bitmap;close=()=>bitmap.close();
 }else{
  const url=URL.createObjectURL(file);close=()=>URL.revokeObjectURL(url);
  try {image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Не удалось прочитать фото'));img.src=url;});}
  catch(error){close();throw error;}
 }
 try {
  const scale=Math.min(1,2400/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const context=canvas.getContext('2d');if(!context) throw Error('Не удалось подготовить фото. Попробуйте другой браузер или снимок.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось подготовить фото')), 'image/jpeg',0.9));
  return new File([blob],'evidence.jpg',{type:'image/jpeg',lastModified:file.lastModified});
 } finally {close();}
}
