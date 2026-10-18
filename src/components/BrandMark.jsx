import { useId } from 'react';

const STAR = 'M12 2c.6 5.4 2.6 8.4 10 10-7.4 1.6-9.4 4.6-10 10-.6-5.4-2.6-8.4-10-10 7.4-1.6 9.4-4.6 10-10z';
const DEW = 'M0 -5C2.6 -1.6 4 .6 4 2.4A4 4 0 0 1 -4 2.4C-4 .6 -2.6 -1.6 0 -5z';

export function BrandMark({ size = 40, mini, className }) {
  const uid = useId().replace(/:/g, '');
  const isMini = mini ?? size <= 24;
  const star = (x, y, s, o = 1, cls) => (
    <path className={cls} d={STAR} fill="#fff" fillOpacity={o} transform={`translate(${x} ${y}) scale(${s}) translate(-12 -12)`} />
  );
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6a9bff" style={{ stopColor: 'color-mix(in srgb, var(--accent, #3b6cf4) 70%, #fff)' }} />
          <stop offset="1" stopColor="#3563ee" style={{ stopColor: 'color-mix(in srgb, var(--accent, #3b6cf4) 90%, #000)' }} />
        </linearGradient>
        <radialGradient id={`h${uid}`} cx=".25" cy=".1" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`c${uid}`}><rect width="64" height="64" rx="16" /></clipPath>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#g${uid})`} />
      <rect width="64" height="64" rx="16" fill={`url(#h${uid})`} />
      {isMini ? (
        <>
          {star(32, 27, 1.55)}
          <path d={DEW} fill="#fff" fillOpacity=".92" transform="translate(32 52) scale(1.05)" />
        </>
      ) : (
        <>
          <g clipPath={`url(#c${uid})`}>
            <path d="M0 41C13 31 24 35 32 45 40 35 51 31 64 40V64H0z" fill="#fff" fillOpacity=".22" />
            <path d="M0 52C13 46 24 49 32 57 40 49 51 46 64 51V64H0z" fill="#fff" fillOpacity=".42" />
          </g>
          {star(32, 20, 1.15)}
          <g transform="translate(32 40) scale(.8)"><path className="brand-dew" d={DEW} fill="#fff" /></g>
          {star(47, 14, 0.34, 0.75, 'brand-twinkle')}
        </>
      )}
    </svg>
  );
}
