// Keep the two-star silhouette in sync with assets/logo.svg (the static favicon).
export default function Logo({ small = false, animated = false }) {
  return <span className={`logo${small ? ' small' : ''}${animated ? ' is-animated' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="currentColor" focusable="false">
      <path className="logo__spark-main" d="M13 9C13.9 15.6 16.4 18.1 23 19C16.4 19.9 13.9 22.4 13 29C12.1 22.4 9.6 19.9 3 19C9.6 18.1 12.1 15.6 13 9Z"/>
      <path className="logo__spark-small" d="M24 3C24.45 6.25 25.75 7.55 29 8C25.75 8.45 24.45 9.75 24 13C23.55 9.75 22.25 8.45 19 8C22.25 7.55 23.55 6.25 24 3Z"/>
    </svg>
  </span>;
}
