import Tooltip from './Tooltip';

export default function IconButton({ title, description, children, disabled, className = '', buttonRef, ...props }) {
  return <Tooltip title={title} description={description} disabled={disabled}>
    <button type="button" className={`icon-button ${className}`} aria-label={title} disabled={disabled} ref={buttonRef} {...props}>{children}</button>
  </Tooltip>;
}
