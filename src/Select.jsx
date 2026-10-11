import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

const optionText = value => Children.toArray(value).map(child => isValidElement(child) ? optionText(child.props.children) : String(child)).join('');

export default function Select({ value, onChange, children, disabled, id, className = '', 'aria-label': ariaLabel }) {
  const uid = useId(), listId = `select-${uid}`, root = useRef(), trigger = useRef(), list = useRef(), typeahead = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [position, setPosition] = useState({}), [label, setLabel] = useState(ariaLabel);
  const options = Children.toArray(children).filter(isValidElement).map(option => ({ value: String(option.props.value ?? optionText(option.props.children)), label: optionText(option.props.children), disabled: !!option.props.disabled }));
  const selected = options.findIndex(option => option.value === String(value)), current = options[selected];
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

  function show() {
    if (disabled || trigger.current.matches(':disabled') || !enabled.length) return;
    const rect = trigger.current.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 220), innerWidth - 24);
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16, preferred = Math.min(288, options.length * 40 + 12), upwards = below < preferred && above > below;
    setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), maxHeight: Math.max(80, Math.min(288, upwards ? above : below)), ...(upwards ? { bottom: innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    setActive(selected >= 0 && !current.disabled ? selected : enabled[0]); setOpen(true);
  }
  function close() { setOpen(false); }
  function choose(index) {
    const option = options[index];
    if (!option || option.disabled || disabled || trigger.current.matches(':disabled')) return;
    close(); trigger.current.focus({ preventScroll: true });
    if (option.value !== String(value)) onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } });
  }
  function keydown(event) {
    if (disabled || trigger.current.matches(':disabled')) return;
    const key = event.key;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { show(); return; }
      if (key === 'Enter' || key === ' ') { choose(active); return; }
      if (key === 'Home') setActive(enabled[0]);
      else if (key === 'End') setActive(enabled.at(-1));
      else { const index = enabled.indexOf(active); setActive(enabled[(index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]); }
    } else if (key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); trigger.current.focus(); }
    else if (key === 'Tab') close();
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now(), query = (now - typeahead.current.time < 700 ? typeahead.current.text : '') + key;
      typeahead.current = { text: query, time: now };
      const match = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
      if (match >= 0) { if (!open) show(); setActive(match); }
    }
  }
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current.contains(event.target)) close(); };
    const resized = () => close();
    document.addEventListener('pointerdown', outside); document.addEventListener('scroll', outside, true); window.addEventListener('resize', resized);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', outside, true); window.removeEventListener('resize', resized); };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    const parent = root.current.closest('label');
    setLabel(ariaLabel || (parent ? [...parent.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim() : undefined));
  }, [ariaLabel]);
  useEffect(() => {
    const menu = list.current, option = menu?.children[active]; if (!open || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [open, active]);
  return <div className={`custom-select ${className}`} ref={root} onKeyDown={keydown}>
    <button ref={trigger} id={id} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled} className="select-trigger" onClick={() => open ? close() : show()} title={current?.label}>
      <span>{current?.label || '请选择'}</span><ChevronDown size={15} className={open ? 'select-chevron open' : 'select-chevron'}/>
    </button>
    {open && <div ref={list} id={listId} role="listbox" className="select-options" style={position} aria-label={label || '可选项'}>
      {options.map((option, index) => <button type="button" role="option" id={`${listId}-${index}`} key={option.value} aria-selected={index === selected} aria-disabled={option.disabled} disabled={option.disabled} tabIndex={-1} className={`select-option ${index === selected ? 'selected' : ''} ${index === active ? 'highlighted' : ''}`} onPointerMove={() => !option.disabled && setActive(index)} onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); choose(index); }}>
        <span>{option.label}</span>{index === selected ? <Check size={15}/> : <span className="select-check-space"/>}
      </button>)}
    </div>}
  </div>;
}
