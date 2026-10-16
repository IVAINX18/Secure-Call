import type { HTMLAttributes, ReactNode } from 'react';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export default function Tag({ className = '', children, ...rest }: TagProps) {
  return (
    <span
      className={['inline-flex items-center rounded-small border border-faded px-2.5 py-1 text-xs font-medium text-ink', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
