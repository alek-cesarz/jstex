import './define-guard'; // must stay first: see define-guard.ts
import '@eox/map';
import '@eox/drawtools';
import type { RenderProps } from '@anywidget/types';
import './styles.css';

function render({ el }: RenderProps): () => void {
  const root = document.createElement('div');
  root.className = 'jstex';
  root.innerHTML = '<eox-map class="jstex-map" style="height:300px"></eox-map>';
  el.appendChild(root);
  const map = root.querySelector('eox-map') as HTMLElement & { layers: unknown; zoom: number };
  map.layers = [
    {
      type: 'Tile',
      properties: { id: 'basemap' },
      source: { type: 'XYZ', url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg' },
    },
  ];
  map.zoom = 3;
  return () => root.remove();
}

export default { render };
