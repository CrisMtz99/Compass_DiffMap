import type { NodeKind } from '@compass/core';

const P = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function KindIcon({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case 'repo':
    case 'directory':
      return (
        <svg {...P}>
          <path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'file':
      return (
        <svg {...P}>
          <path d="M4 2h5l3 3v9H4z" />
          <path d="M9 2v3h3" />
        </svg>
      );
    case 'class':
    case 'interface':
    case 'enum':
      return (
        <svg {...P}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M10 6.2a2.4 2.4 0 1 0 0 3.6" />
        </svg>
      );
    case 'property':
      return (
        <svg {...P}>
          <circle cx="8" cy="8" r="2.5" />
        </svg>
      );
    case 'type':
      return (
        <svg {...P}>
          <path d="M3 4h10M8 4v9" />
        </svg>
      );
    default:
      return (
        <svg {...P}>
          <path d="M6 2.5C4 2.5 4.5 5 4.5 6S3 8 3 8s1.5 0 1.5 2S4 13.5 6 13.5M10 2.5c2 0 1.5 2.5 1.5 3.5S13 8 13 8s-1.5 0-1.5 2 .5 3.5-1.5 3.5" />
        </svg>
      );
  }
}

export const Icon = {
  explore: (
    <svg {...P}>
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  callers: (
    <svg {...P}>
      <path d="M13 8H3M6 5L3 8l3 3M13 4v8" />
    </svg>
  ),
  deps: (
    <svg {...P}>
      <path d="M3 8h10M10 5l3 3-3 3M3 4v8" />
    </svg>
  ),
  code: (
    <svg {...P}>
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
    </svg>
  ),
  back: (
    <svg {...P}>
      <path d="M10 3L5 8l5 5" />
    </svg>
  ),
  fwd: (
    <svg {...P}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  ),
  minus: (
    <svg {...P}>
      <path d="M3.5 8h9" />
    </svg>
  ),
  plus: (
    <svg {...P}>
      <path d="M3.5 8h9M8 3.5v9" />
    </svg>
  ),
  fit: (
    <svg {...P}>
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
    </svg>
  ),
  compass: (
    <svg {...P} strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6" />
      <path d="M10.5 5.5L9 9l-3.5 1.5L7 7z" />
    </svg>
  ),
  search: (
    <svg {...P}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  ),
  play: (
    <svg {...P}>
      <path d="M5 3l8 5-8 5z" />
    </svg>
  ),
  branch: (
    <svg {...P}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 3-7 2-7 4" />
    </svg>
  ),
  close: (
    <svg {...P}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  ),
  health: (
    <svg {...P}>
      <path d="M2 8h3l1.5-4 3 8L11 8h3" />
    </svg>
  ),
  doc: (
    <svg {...P}>
      <path d="M4 2h8v12H4zM6 5.5h4M6 8h4M6 10.5h2.5" />
    </svg>
  ),
};
