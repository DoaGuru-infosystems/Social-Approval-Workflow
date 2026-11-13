import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Button from '../components/Button';
import { Layers, Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      const msg = 'Kripya email aur password dono daalein.';
      setError(msg);
      showToast(msg, 'warning');
      return;
    }

    setIsLoading(true);
    try {
      const data = await login({ email: email.trim(), password });
      const userRole = data?.user?.role;

      showToast(`Swagat hai, ${data?.user?.name || 'User'}! Login safal raha.`, 'success');

      // Strict role-based automatic dashboard redirect
      if (userRole === 'admin') {
        navigate('/admin', { replace: true });
      } else if (userRole === 'manager') {
        navigate('/manager', { replace: true });
      } else {
        navigate('/smo', { replace: true });
      }
    } catch (err) {
      let friendlyError = 'Email ya password galat hai. Kripya dobara check karein.';
      if (!err.response) {
        friendlyError = 'Server se connection nahi ho pa raha hai. Kripya check karein ki server chal raha hai.';
      } else if (err.response.data?.message) {
        friendlyError = err.response.data.message;
      }
      setError(friendlyError);
      showToast(friendlyError, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6] text-[#2B2A27] p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 shadow-sm shadow-emerald-900/5 mb-4">
            <Layers className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2B2A27]">
            Central Post Hub
          </h1>
          <p className="text-sm text-[#6B6A63] mt-1">
            Social Approval & Publishing Workflow Platform
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#FFFFFF] rounded-3xl p-8 border border-[#E5E2DA] shadow-xl shadow-stone-900/5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-[#2B2A27] placeholder-[#A8A29E] text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 focus:bg-white focus:outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-11 pr-11 py-2.5 rounded-xl border border-[#E5E2DA] bg-[#FAF9F6] text-[#2B2A27] placeholder-[#A8A29E] text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 focus:bg-white focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#6B6A63] hover:text-[#2B2A27] focus:outline-none transition-colors cursor-pointer p-0.5"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Eye className="w-4 h-4 text-[#A8A29E] hover:text-[#2B2A27]" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              loading={isLoading}
              disabled={!isFormValid || isLoading}
              className="w-full !rounded-xl"
            >
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
