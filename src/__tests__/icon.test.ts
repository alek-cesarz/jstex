import { LabIcon } from '@jupyterlab/ui-components';
import { describe, expect, it } from 'vitest';
import { stexIcon } from '../icon';

describe('extension icon', () => {
  it('registers the STEX logo as a LabIcon', () => {
    expect(stexIcon.name).toBe('jupyterlab-jstex:logo');
    expect(LabIcon.resolve({ icon: 'jupyterlab-jstex:logo' })).toBe(stexIcon);
    // STEX's mark: orange layers on the navy tile.
    expect(stexIcon.svgstr).toContain('#081B3B');
    expect(stexIcon.svgstr).toContain('#FF8225');
  });
});
