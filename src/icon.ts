/**
 * The extension's icon: STEX's logo (orange layered map on the navy tile).
 * Copied from STEX public/favicon.svg @ ba9e39f — keep in sync by hand.
 * Registered by name so later UI (side panel, launcher) can use it.
 */
import { LabIcon } from '@jupyterlab/ui-components';

export const STEX_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 36 36" fill="none">
  <rect width="36" height="36" rx="4" fill="#081B3B"/>
  <g opacity="0.08" transform="translate(0,6)"><path d="M3 20 L18 26 L33 20 L18 14 Z" stroke="#ffffff" stroke-width="0.6" fill="none"/></g>
  <g opacity="0.15"><path d="M3 20 L18 26 L33 20 L18 14 Z" stroke="#ffffff" stroke-width="0.6" fill="none"/></g>
  <g transform="translate(0,-6)">
    <path d="M3 20 L18 26 L33 20 L18 14 Z" stroke="#FF8225" stroke-width="1.2" fill="#FF8225" fill-opacity="0.05"/>
    <line x1="10.5" y1="17" x2="10.5" y2="23" stroke="#FF8225" stroke-width="0.5" opacity="0.3"/>
    <line x1="18" y1="14" x2="18" y2="20" stroke="#FF8225" stroke-width="0.5" opacity="0.3"/>
    <line x1="25.5" y1="17" x2="25.5" y2="23" stroke="#FF8225" stroke-width="0.5" opacity="0.3"/>
    <line x1="10.5" y1="20" x2="25.5" y2="20" stroke="#FF8225" stroke-width="0.5" opacity="0.3"/>
    <path d="M18 14 L25.5 17 L25.5 20 L18 20 Z" fill="#FF8225" opacity="0.25"/>
    <circle cx="21.5" cy="17" r="1.3" fill="#FF8225"/>
  </g>
</svg>`;

export const stexIcon = new LabIcon({
  name: 'jupyterlab-jstex:logo',
  svgstr: STEX_LOGO_SVG
});
