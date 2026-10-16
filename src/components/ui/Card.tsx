import type { HTMLAttributes, ReactNode } from 'react';

type CardVariant = 'paper' | 'mist' | 'blush';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  elevated?: boolean;
  children: ReactNode;
}

const variantClasses: Record<CardVariant, string> = {
  paper: 'bg-paper',
  mist: 'bg-mist',
  blush: 'bg-blush',
};

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-10',
};

export default function Card({
  variant = 'paper',
  padding = 'md',
  elevated = false,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        'rounded-card',
        variantClasses[variant],
        paddingClasses[padding],
        elevated ? 'shadow-photo' : 'border border-mist',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
