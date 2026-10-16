import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helper?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helper, error, id, className = '', ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = helper ? `${inputId}-helper` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[helperId, errorId].filter(Boolean).join(' ') || undefined}
        className={[
          'min-h-[44px] w-full rounded-small border border-faded bg-paper px-3.5 text-base text-ink',
          'placeholder:text-ink/40 focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/30',
          'disabled:cursor-not-allowed disabled:bg-mist disabled:text-ink/40',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {helper && !error && (
        <p id={helperId} className="text-sm text-ink/60">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
});

export default Input;
