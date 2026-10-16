import type { HTMLAttributes } from 'react';

type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
};

export default function Spinner({ size = 'md', className = '', ...rest }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block animate-spin rounded-full border-2 border-iris/20 border-t-iris', sizeClasses[size], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
