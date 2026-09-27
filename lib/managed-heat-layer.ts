import L from 'leaflet';
import 'leaflet.heat';

// Leaflet.heat 0.2.0 leaves its RAF pending on remove. Its synchronous _reset
// also calls _redraw and clears _frame, losing the outstanding RAF handle.
// Keep cancellation at BOTH entry points, before Leaflet detaches the map.
export function managedHeatLayer(options: L.HeatMapOptions): L.HeatLayer {
  const layer = L.heatLayer([], options) as L.HeatLayer & { _frame: number | null; _redraw: () => void };
  const redraw = layer._redraw;
  const remove = layer.onRemove;
  const cancel = () => { if (layer._frame != null) L.Util.cancelAnimFrame(layer._frame); layer._frame = null; };
  layer._redraw = function () { cancel(); redraw.call(this); };
  layer.onRemove = function (map: L.Map) { cancel(); return remove.call(this,map); };
  return layer;
}
