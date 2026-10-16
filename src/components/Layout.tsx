import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogOut } from 'lucide-react';
import Logo from './Logo';

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      {/* Persistent header: 80px white bar, hairline below, no shadow. */}
      <header className="bg-paper border-b border-mist">
        <div className="max-w-page mx-auto px-6">
          <div className="flex justify-between h-20 items-center">
            <Link
              to="/dashboard"
              aria-label="SecureCall home"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
            >
              <Logo />
            </Link>
            <div className="flex items-center">
              <div className="relative group">
                {/* User chip: mist pill, 44px tap target. */}
                <button
                  aria-label="Account menu"
                  className="flex items-center gap-2 min-h-[44px] rounded-pill bg-mist px-4 py-2 text-base font-medium text-ink transition-colors hover:bg-blush focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper">
                    <User className="h-5 w-5 text-ink" aria-hidden="true" />
                  </span>
                  <span>{user?.username}</span>
                </button>
                {/* Dropdown: paper surface on mist border, hover-revealed. */}
                <div className="absolute right-0 mt-2 w-48 rounded-card border border-mist bg-paper py-2 z-10 hidden group-hover:block group-focus-within:block">
                  <button
                    onClick={handleLogout}
                    className="flex min-h-[44px] w-full items-center px-4 py-2 text-left text-sm font-medium text-ink hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris/30"
                  >
                    <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="bg-paper">
        <div className="max-w-page mx-auto px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
