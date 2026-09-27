'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';
import type { HeatmapPoint, Hotspot } from '@/lib/analytics';
import { getCategoryLabel } from '@/lib/categories';
import type { ReportCategory } from '@/lib/types';
import styles from './heatmap-map.module.css';

interface Props {
  points: HeatmapPoint[]; hotspots: Hotspot[]; selected: string | null;
  onSelect: (id: string) => void;
}
export function HeatmapMap({ points, hotspots, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const heat = useRef<L.HeatLayer | null>(null);
  const indicators = useRef<L.LayerGroup | null>(null);
  const fit = () => {
    if (!map.current) return;
    if (points.length) map.current.fitBounds(L.latLngBounds(points.map(p => [p.latitude,p.longitude])), { padding: [48,48], maxZoom: 15 });
    else map.current.setView([43.6588,51.1655],12);
  };
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([43.6588,51.1655],12);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19, className: styles.tiles,
    }).addTo(instance);
    heat.current = L.heatLayer([], {
      radius: 36, blur: 28, max: 6, maxZoom: 14, minOpacity: 0.22,
      gradient: { 0.15: '#164e9b', 0.4: '#168ee0', 0.65: '#22d3ee', 1: '#c5f6ff' },
    }).addTo(instance);
    indicators.current = L.layerGroup().addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; heat.current = null; indicators.current = null; };
  }, []);
  useEffect(() => {
    heat.current?.setLatLngs(points.map(p => [p.latitude,p.longitude,p.intensity]));
    fit();
    // Fit once per new filtered dataset, not on every selection/render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);
  useEffect(() => {
    const layer = indicators.current;
    if (!layer) return;
    layer.clearLayers();
    hotspots.forEach((zone, index) => {
      const label = `${getCategoryLabel(zone.category as ReportCategory)}: ${zone.report_count} обращений`;
      L.marker([zone.center_lat,zone.center_lng], {
        title: label, alt: label,
        icon: L.divIcon({ className: styles.hotspot, html: `<span>${index + 1}</span>`, iconSize: [30,30], iconAnchor: [15,15] }),
      }).on('click', () => onSelect(zone.hotspot_id)).addTo(layer);
    });
  }, [hotspots,onSelect]);
  useEffect(() => {
    const zone = hotspots.find(item => item.hotspot_id === selected);
    if (zone) map.current?.flyTo([zone.center_lat,zone.center_lng],16,{duration:0.6});
  }, [selected,hotspots]);
  return <div className={styles.frame}>
    <div ref={container} className={styles.map} role="region" aria-label="Тепловая карта реальных обращений" />
    <button type="button" onClick={fit} className={styles.fit}>Показать все точки</button>
    <div className={styles.legend}><span>Ниже</span><i/><span>Выше концентрация</span></div>
  </div>;
}
