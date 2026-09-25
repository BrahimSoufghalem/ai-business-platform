import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons';

export interface FormFieldProps {
  label: string;
  /** Single form control (Input/Select/Textarea/PasswordInput). id and aria attributes are injected. */
  children: ReactElement;
  hint?: string | undefined;
  error?: string | null | undefined;
  required?: boolean;
  className?: string;
}

export function FormField({ label, children, hint, error, required, className }: FormFieldProps) {
  const autoId = useId();
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: autoId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      } as Record<string, unknown>)
    : children;

  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={autoId}>
        {label}
        {required ? (
          <>
            {' '}
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </>
        ) : null}
      </label>
      {control as ReactNode}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="alert-circle" size={15} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
