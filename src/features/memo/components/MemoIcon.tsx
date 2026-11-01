import type { SVGProps } from 'react';

export default function MemoIcon({
  size = 18,
  strokeWidth = 1.75,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}
