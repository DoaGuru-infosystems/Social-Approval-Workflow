const isBrowser = typeof window !== 'undefined';
const isLocalhost =
  isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Prioritize environment variables from client/.env (VITE_API_BASE_URL & VITE_SERVER_URL)
const envApiBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : null;
const envServerUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SERVER_URL : null;

export const API_BASE_URL =
  envApiBase || (isLocalhost ? 'http://localhost:5001/api' : '/api');

export const SERVER_URL =
  envServerUrl || (isLocalhost ? 'http://localhost:5001' : (isBrowser ? window.location.origin : ''));

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
