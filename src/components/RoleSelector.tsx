import React from 'react';
import { useRole } from '../contexts/RoleContext';
import { UserSquare2, Users } from 'lucide-react';
import { Card } from './ui';

interface RoleSelectorProps {
  onSelect: () => void;
}

const RoleSelector: React.FC<RoleSelectorProps> = ({ onSelect }) => {
  const { setRole } = useRole();

  const handleRoleSelect = (selectedRole: 'host' | 'guest') => {
    setRole(selectedRole);
    onSelect();
  };

  const tileClasses = [
    'flex min-h-[44px] w-full items-center justify-center gap-4 rounded-card border border-faded bg-paper p-6 text-left',
    'transition-colors hover:border-iris hover:bg-iris/10',
    'active:bg-iris active:text-paper active:[&_span]:text-paper active:[&_svg]:text-paper',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 focus-visible:ring-offset-2',
  ].join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 font-sans">
      <Card variant="paper" padding="lg" elevated className="mx-auto w-full max-w-page sm:max-w-xl">
        <h2 className="text-center font-display text-[40px] font-normal leading-[1.15] text-ink">
          Select Your Role
        </h2>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <button type="button" onClick={() => handleRoleSelect('host')} className={tileClasses}>
            <UserSquare2 className="h-8 w-8 shrink-0 text-ink" aria-hidden="true" />
            <span className="text-left">
              <span className="block font-serif text-[28px] font-normal leading-[1.25] text-ink">
                Host
              </span>
              <span className="mt-1 block text-base font-normal leading-relaxed text-ink/80">
                <span className="text-iris" aria-hidden="true">+ </span>
                Create and manage the call
              </span>
            </span>
          </button>

          <button type="button" onClick={() => handleRoleSelect('guest')} className={tileClasses}>
            <Users className="h-8 w-8 shrink-0 text-ink" aria-hidden="true" />
            <span className="text-left">
              <span className="block font-serif text-[28px] font-normal leading-[1.25] text-ink">
                Guest
              </span>
              <span className="mt-1 block text-base font-normal leading-relaxed text-ink/80">
                <span className="text-iris" aria-hidden="true">+ </span>
                Join an existing call
              </span>
            </span>
          </button>
        </div>
      </Card>
    </div>
  );
};

export default RoleSelector;
