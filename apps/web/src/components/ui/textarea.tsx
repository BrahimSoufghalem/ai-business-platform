import { forwardRef, type TextareaHTMLAttributes } from 'react';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, dir, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      dir={dir ?? 'auto'}
      className={['textarea', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});
