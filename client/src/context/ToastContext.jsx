import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'success', duration = 3500) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => {
          let styles = 'bg-[#FFFFFF] border-[#E5E2DA] text-[#2B2A27] shadow-lg shadow-stone-900/5';
          let Icon = CheckCircle2;
          let iconColor = 'text-emerald-600';

          if (toast.type === 'error') {
            styles = 'bg-[#FFFFFF] border-rose-300 text-[#2B2A27] shadow-lg shadow-rose-900/5';
            Icon = XCircle;
            iconColor = 'text-rose-600';
          } else if (toast.type === 'warning') {
            styles = 'bg-[#FFFFFF] border-amber-300 text-[#2B2A27] shadow-lg shadow-amber-900/5';
            Icon = AlertTriangle;
            iconColor = 'text-amber-600';
          } else {
            styles = 'bg-[#FFFFFF] border-emerald-300 text-[#2B2A27] shadow-lg shadow-emerald-900/5';
            Icon = CheckCircle2;
            iconColor = 'text-emerald-600';
          }

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-3.5 rounded-2xl border flex items-start gap-3 transition-all duration-200 animate-in fade-in slide-in-from-top-3 ${styles}`}
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
              <div className="flex-1 text-xs font-medium leading-relaxed">
                {toast.message}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-[#6B6A63] hover:text-[#2B2A27] transition-colors cursor-pointer p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastContext;
