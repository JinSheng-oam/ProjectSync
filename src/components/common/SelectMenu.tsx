import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface SelectMenuProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}

export function SelectMenu({ label, value, options, onChange, className = '' }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.findIndex((option) => option.value === value);
  const openMenu = () => {
    if (!options.length) return;
    setActive(Math.max(0, selected));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  };

  return (
    <div ref={root} className={`relative min-w-0 ${className}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}：${options[selected]?.label ?? '请选择'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={!options.length}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
        className="flex min-h-8 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-800 outline-none hover:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500"
      >
        <span className="truncate">{options[selected]?.label ?? '请选择'}</span>
        <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 text-slate-500 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          tabIndex={-1}
          className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-lg outline-none dark:border-slate-700 dark:bg-slate-900"
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown': setActive((index) => Math.min(index + 1, options.length - 1)); break;
              case 'ArrowUp': setActive((index) => Math.max(index - 1, 0)); break;
              case 'Home': setActive(0); break;
              case 'End': setActive(options.length - 1); break;
              case 'Enter':
              case ' ': choose(active); break;
              case 'Escape': close(); break;
              default: return;
            }
            event.preventDefault();
          }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === selected}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 whitespace-nowrap ${index === active ? 'bg-indigo-50 dark:bg-indigo-950' : ''} ${index === selected ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}
            >
              {option.label}
              <span className="size-3.5 shrink-0">{index === selected && <Check aria-hidden="true" className="size-3.5" />}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
