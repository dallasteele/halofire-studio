import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../src/lib/hydraulics-panel-adapter', () => ({
  getHazenWilliams: vi.fn(async () => ({
    material: 'STEEL_SCH40',
    value: 120,
    citation: 'NFPA 13 Hazen-Williams steel wet-pipe C-factor.',
  })),
  getCoverage: vi.fn(async () => ({
    hazard: 'LIGHT',
    value: '225 ft^2/head max, 15 ft max spacing',
    citation: 'NFPA 13 Light Hazard spacing and area rules.',
  })),
}));

const { HydraulicsPanel } = await import('../src/components/HydraulicsPanel');

afterEach(cleanup);

describe('HydraulicsPanel mount-time adapter readout', () => {
  it('renders Hazen-Williams and coverage values from the adapter', async () => {
    render(<HydraulicsPanel />);

    expect(await screen.findByText('120 (STEEL_SCH40)')).toBeTruthy();
    expect(await screen.findByText('225 ft^2/head max, 15 ft max spacing')).toBeTruthy();
    expect(screen.getByText('Hazen-Williams')).toBeTruthy();
    expect(screen.getByText('Coverage')).toBeTruthy();
  });
});
