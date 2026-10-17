import Tooltip from './Tooltip';

export default function IconButton({ title, description, children, disabled, className = '', buttonRef, nativeTitle = false, ...props }) {
  const button = <button type="button" className={`icon-button ${className}`} aria-label={title} title={nativeTitle ? title : undefined} disabled={disabled} ref={buttonRef} {...props}>{children}</button>;
  return nativeTitle ? button : <Tooltip title={title} description={description} disabled={disabled}>{button}</Tooltip>;
}
