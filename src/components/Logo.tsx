import React from 'react';
import { useLogo } from '../contexts/LogoContext';

// Brand mark: uploaded logo when set, otherwise the serif text wordmark (no default image asset by design).
const Logo: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { logo } = useLogo();

  return (
    <div className={`flex items-center ${className}`}>
      {logo ? (
        <img src={logo} alt="Company Logo" className="h-12 w-auto rounded-card" />
      ) : (
        <span className="font-display text-2xl md:text-[26px] tracking-editorial text-ink">
          SecureCall
        </span>
      )}
    </div>
  );
};

export default Logo;
