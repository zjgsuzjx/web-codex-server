import type * as React from 'react';
import Tooltip from './Tooltip.tsx';
export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onChange' | 'children'> {
  title: string;
  description?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
  nativeTitle?: boolean;
}

export default function IconButton({
  title,
  description,
  children,
  disabled,
  className = '',
  buttonRef,
  nativeTitle = false,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={title}
      title={nativeTitle ? title : undefined}
      disabled={disabled}
      ref={buttonRef}
      {...props}
    >
      {children}
    </button>
  );
  return nativeTitle ? (
    button
  ) : (
    <Tooltip title={title} description={description} disabled={disabled}>
      {button}
    </Tooltip>
  );
}
