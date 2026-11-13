export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getStatusBadgeStyle = (status) => {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-800 border border-emerald-200';
    case 'admin_approved':
    case 'ready_to_publish':
      return 'bg-sky-50 text-sky-800 border border-sky-200';
    case 'changes_requested':
      return 'bg-amber-50 text-amber-800 border border-amber-200';
    case 'pending_manager':
    case 'pending_admin':
      return 'bg-orange-50 text-orange-800 border border-orange-200';
    case 'rejected':
      return 'bg-rose-50 text-rose-800 border border-rose-200';
    case 'draft':
    case 'ai_checking':
    default:
      return 'bg-stone-100 text-stone-700 border border-stone-200';
  }
};
