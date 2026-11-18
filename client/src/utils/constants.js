export const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || 'http://localhost:5001/api';
export const SERVER_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL) || 'http://localhost:5001';

export const GOOGLE_PROJECT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_PROJECT_ID) || 'socel-workflow';
export const GOOGLE_CLOUD_TEST_USER_URL = `https://console.cloud.google.com/auth/audience?project=${GOOGLE_PROJECT_ID}`;

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
