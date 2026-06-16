import React, { useEffect, useState } from 'react';
import { getHazenWilliams } from '../../../engine/adapter.ts';

export function formatHazenWilliamsValue(hazenWilliams) {
  if (!hazenWilliams) {
    return 'Loading...';
  }

  const parts = [];
  if (typeof hazenWilliams.cFactor === 'number') {
    parts.push(`C=${hazenWilliams.cFactor}`);
  }
  if (typeof hazenWilliams.frictionLossPsi === 'number') {
    parts.push(`${hazenWilliams.frictionLossPsi} psi loss`);
  }
  if (typeof hazenWilliams.source === 'string' && hazenWilliams.source) {
    parts.push(hazenWilliams.source);
  }
  return parts.join(' · ') || 'Unavailable';
}

export function InspectorPanel() {
  const [hazenWilliams, setHazenWilliams] = useState(null);

  useEffect(() => {
    let mounted = true;

    getHazenWilliams()
      .then((result) => {
        if (mounted) {
          setHazenWilliams(result?.value ?? null);
        }
      })
      .catch(() => {
        if (mounted) {
          setHazenWilliams(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return React.createElement(
    'section',
    { className: 'inspector-panel', 'data-panel': 'inspector' },
    React.createElement('h2', null, 'Inspector'),
    React.createElement(
      'div',
      { className: 'inspector-field', 'data-field': 'hazen-williams' },
      React.createElement('span', { className: 'inspector-label' }, 'Hazen-Williams'),
      React.createElement(
        'span',
        { className: 'inspector-value', 'data-value': 'hazen-williams' },
        formatHazenWilliamsValue(hazenWilliams),
      ),
    ),
  );
}

export default InspectorPanel;
