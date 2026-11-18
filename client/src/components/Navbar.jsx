import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { LogOut, Layers, Building2, LayoutDashboard } from 'lucide-react';

const Navbar = () => {
  const { user, role, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    showToast('You have been signed out.', 'success');
    navigate('/login', { replace: true });
  };

  const getRoleBadge = (userRole) => {
    switch (userRole) {
      case 'admin':
        return 'bg-stone-100 text-stone-700 border-stone-200';
      case 'manager':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'smo':
      default:
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    }
  };

  const isClientsActive = location.pathname === '/admin' && location.search.includes('tab=clients');
  const isDashboardActive = (
    (location.pathname === '/admin' && !location.search.includes('tab=clients')) ||
    (location.pathname === '/manager') ||
    (location.pathname === '/smo')
  );

  return (
    <header className="sticky top-0 z-40 bg-[#FFFFFF]/90 backdrop-blur-md border-b border-[#E5E2DA] text-[#2B2A27]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 group-hover:border-emerald-300 transition-all">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-[#2B2A27] leading-tight block">
              Central Post Hub
            </span>
            <span className="text-[11px] text-[#6B6A63] font-medium">Social Approval Platform</span>
          </div>
        </Link>

        {/* Navigation Links for Authenticated Users (SMO, Manager, Admin) */}
        {user && (
          <div className="hidden md:flex items-center gap-2">
            <Link
              to={role === 'admin' ? '/admin' : role === 'manager' ? '/manager' : '/smo'}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                isDashboardActive
                  ? 'bg-stone-100 text-[#2B2A27] border border-[#E5E2DA] shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-[#2B2A27] hover:bg-stone-50 border border-transparent'
              }`}
            >
              <LayoutDashboard className={`w-3.5 h-3.5 ${isDashboardActive ? 'text-emerald-700' : 'text-stone-500'}`} />
              <span>Dashboard</span>
            </Link>

            <Link
              to="/admin?tab=clients"
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                isClientsActive
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200 shadow-2xs font-bold'
                  : 'text-stone-600 hover:text-[#2B2A27] hover:bg-stone-50 border border-transparent'
              }`}
            >
              <Building2 className={`w-3.5 h-3.5 ${isClientsActive ? 'text-emerald-600' : 'text-stone-500'}`} />
              <span>Clients &amp; Accounts</span>
            </Link>
          </div>
        )}

        {/* User Info & Actions */}
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-sm font-semibold text-[#2B2A27]">
                  {user.name || user.email || 'Logged in User'}
                </span>
                <span className="text-xs text-[#6B6A63] uppercase font-mono tracking-wider">
                  {user.role === 'smo' ? 'SMO' : user.role || 'Member'}
                </span>
              </div>

              <div
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${getRoleBadge(
                  role
                )}`}
              >
                {role === 'smo' ? 'SMO' : role || 'User'}
              </div>

              <button
                onClick={handleLogout}
                title="Logout"
                className="p-2 rounded-lg text-[#6B6A63] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
