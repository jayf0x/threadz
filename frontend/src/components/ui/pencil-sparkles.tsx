import type { SVGProps } from "react";

// lucide has a pencil and sparkles but no pencil-sparkles: same 24px grid and stroke, drawn to match.
export const PencilSparkles = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...props}
  >
    <g transform="translate(5 4.5) scale(0.8)" strokeWidth="2.5">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </g>
    <path d="M6 1.5l1.2 3.3L10.5 6 7.2 7.2 6 10.5 4.8 7.2 1.5 6l3.3-1.2z" fill="currentColor" strokeWidth="1" />
  </svg>
);
