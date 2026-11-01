import { LoaderCircle } from 'lucide-react';
export interface LoadingPlaceholderProps {
  label?: string;
  variant?: string;
  rows?: number;
}

export default function LoadingPlaceholder({
  label = '正在加载…',
  variant = 'panel',
  rows = 4,
}: LoadingPlaceholderProps) {
  return (
    <div className={`loading-placeholder loading-${variant}`} role="status" aria-live="polite">
      <span className="loading-caption">
        <LoaderCircle size={15} className="spin" />
        {label}
      </span>
      <div className="skeleton-lines" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span className="skeleton" key={i} />
        ))}
      </div>
    </div>
  );
}
