const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
let next=1,frames=new Map(),draws=0;
const L={Layer:{extend:methods=>{function Layer(...args){this.initialize(...args);}Object.assign(Layer.prototype,methods);return Layer;}},
 setOptions:(layer,options)=>layer.options=options,Util:{requestAnimFrame:(fn,ctx)=>{const id=next++;frames.set(id,()=>fn.call(ctx));return id;},cancelAnimFrame:id=>frames.delete(id)},
 Bounds:function(){},point:a=>a,Browser:{any3d:false}};
vm.runInNewContext(fs.readFileSync('node_modules/leaflet.heat/src/HeatLayer.js','utf8'),{L});
const size={x:300,y:300,add:()=>size};
const map=()=>({getSize:()=>size,getMaxZoom:()=>18,getZoom:()=>14,_getMapPanePos:()=>({x:0,y:0}),getPanes:()=>({overlayPane:{removeChild:()=>{}}}),off:()=>{},options:{zoomAnimation:false}});
const attach=layer=>{layer._map=map();layer._heat={_r:10,data(){return this;},draw(){draws++;}};return layer;};
const flush=()=>{const current=[...frames.values()];frames.clear();current.forEach(fn=>fn());};
// Reproduce the exception with the actual installed plugin, not a reimplementation.
const broken=attach(L.heatLayer([],{}));broken.redraw();broken.onRemove(broken._map);broken._map=null;assert.throws(flush,/getSize/);
const compiled=ts.transpileModule(fs.readFileSync('lib/managed-heat-layer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('exports','require','module',compiled)(mod.exports,name=>name==='leaflet'?{default:L}:{},mod);
for(let i=0;i<100;i++){
 const layer=attach(mod.exports.managedHeatLayer({}));layer.redraw();assert.equal(frames.size,1);
 // moveend/_reset invokes _redraw synchronously while another frame is pending.
 layer._redraw();assert.equal(frames.size,0);layer.redraw();assert.equal(frames.size,1);
 layer.onRemove(layer._map);layer._map=null;assert.equal(frames.size,0);assert.doesNotThrow(flush);
 attach(layer);layer.redraw();flush();assert.equal(frames.size,0);layer.onRemove(layer._map);layer._map=null;
}
assert.equal(draws,200);
console.log('PASS: real Leaflet.heat crash reproduced; 100 mount/redraw/remove/remount cycles cancel pending and overwritten RAF, no detached-map reads.');
