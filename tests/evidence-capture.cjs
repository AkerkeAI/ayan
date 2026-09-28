const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,mocks={}){const m={exports:{}};new Function('exports','require','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,n=>mocks[n]||require(n),m);return m.exports;}
const {currentEvidenceSignals,stripPhotoMetadata}=load('lib/resolutions/capture.ts');
(async()=>{
 let calls=0;Object.defineProperty(global,'navigator',{value:{geolocation:{getCurrentPosition:(success,error,options)=>{calls++;assert.equal(options.maximumAge,0);assert.equal(options.timeout,10000);success({coords:{latitude:43,longitude:51,accuracy:12},timestamp:Date.now()});}}},configurable:true});
 assert.equal((await currentEvidenceSignals({source:'file'})).gps.accuracy,12);assert.equal(calls,1);
 assert.equal((await currentEvidenceSignals({source:'camera'})).gps.accuracy,12);
 navigator.geolocation.getCurrentPosition=(_,error)=>error({code:1});await assert.rejects(currentEvidenceSignals({source:'file'}),/геолокации/);
 navigator.geolocation.getCurrentPosition=()=>{throw Error('Permission policy blocked')};await assert.rejects(currentEvidenceSignals({source:'file'}),/геолокации/);
 navigator.geolocation.getCurrentPosition=(success)=>success({coords:{latitude:43,longitude:51,accuracy:10},timestamp:Date.now()-180000});await assert.rejects(currentEvidenceSignals({source:'file'}),/геолокации/);
 navigator.geolocation=null;await assert.rejects(currentEvidenceSignals({source:'file'}),/геолокации/);
 let closed=false,drew=false;
 global.createImageBitmap=async()=>({width:4000,height:2000,close:()=>closed=true});
 global.document={createElement:()=>({getContext:()=>({drawImage:()=>drew=true}),toBlob:(callback,type)=>{assert.equal(type,'image/jpeg');callback(new Blob(['new raster without EXIF'],{type}));}})};
 const result=await stripPhotoMetadata(new File(['secret GPS EXIF'],'original.jpg',{type:'image/jpeg',lastModified:100}));
 assert.equal(await result.text(),'new raster without EXIF');assert.equal(result.lastModified,100);assert(closed&&drew);
 console.log('PASS: mandatory GPS automatic fresh sample; denial/absence/policy failure stop submission; uploaded image is re-encoded without source metadata.');
})().catch(e=>{console.error(e);process.exitCode=1});
