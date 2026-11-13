export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

export const ROLES = {
  SMO: 'smo',
  MANAGER: 'manager',
  ADMIN: 'admin',
};

export const POST_STATUS = {
  DRAFT: 'draft',
  PENDING_AI_CHECK: 'pending_ai_check',
  AI_APPROVED: 'ai_approved',
  AI_FLAGGED: 'ai_flagged',
  PENDING_MANAGER_APPROVAL: 'pending_manager_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
};

export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', tagClass: 'bg-rose-50 text-rose-700 border border-rose-200' },
  { id: 'facebook', name: 'Facebook', tagClass: 'bg-sky-50 text-sky-700 border border-sky-200' },
  { id: 'youtube', name: 'YouTube', tagClass: 'bg-red-50 text-red-700 border border-red-200' },
];
