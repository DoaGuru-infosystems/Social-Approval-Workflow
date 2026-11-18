import api from './api';

export const clientService = {
  // Get all clients (active by default, or all with { all: 'true' })
  getClients: async (params = {}) => {
    const response = await api.get('/clients', { params });
    return response.data;
  },

  // Get single client details with guidelines and social accounts
  getClientById: async (id) => {
    const response = await api.get(`/clients/${id}`);
    return response.data;
  },

  // Create new client (Admin only)
  createClient: async (data) => {
    const response = await api.post('/clients', data);
    return response.data;
  },

  // Update client name or active status (Admin only)
  updateClient: async (id, data) => {
    const response = await api.put(`/clients/${id}`, data);
    return response.data;
  },

  // Soft delete / deactivate client (Admin only)
  deleteClient: async (id) => {
    const response = await api.delete(`/clients/${id}`);
    return response.data;
  },

  // Get brand guidelines for client
  getBrandGuidelines: async (clientId) => {
    const response = await api.get(`/clients/${clientId}/brand-guidelines`);
    return response.data;
  },

  // Update brand guidelines for client
  updateBrandGuidelines: async (clientId, guidelinesData) => {
    const response = await api.put(`/clients/${clientId}/brand-guidelines`, guidelinesData);
    return response.data;
  },

  // Get connected social accounts for client
  getClientSocialAccounts: async (clientId) => {
    const response = await api.get(`/clients/${clientId}/social-accounts`);
    return response.data;
  },

  // Direct connect social account (Admin testing & manual linking)
  connectSocialAccount: async (clientId, data) => {
    const response = await api.post(`/clients/${clientId}/social-accounts`, data);
    return response.data;
  },

  // Disconnect social account
  disconnectSocialAccount: async (clientId, accountId) => {
    const response = await api.delete(`/clients/${clientId}/social-accounts/${accountId}`);
    return response.data;
  },

  // Get OAuth URL to initiate Meta connect
  getSocialConnectUrl: async (clientId, platform) => {
    const response = await api.get(`/clients/${clientId}/social/connect/${platform}?json=true`);
    return response.data;
  },

  // Trigger manual GMB sync for client (Admin only)
  syncGmb: async (clientId) => {
    const response = await api.post(`/clients/${clientId}/sync-gmb`);
    return response.data;
  },

  // 4-Platform Social Connect System
  getSocialPlatforms: async (clientId) => {
    const response = await api.get(`/clients/${clientId}/social`);
    return response.data;
  },

  getOAuthUrl: async (clientId, platform) => {
    const response = await api.get(`/clients/${clientId}/social/${platform}/connect`);
    return response.data;
  },

  manualConnectSocial: async (clientId, data) => {
    const response = await api.post(`/clients/${clientId}/social/manual-connect`, data);
    return response.data;
  },

  disconnectSocialPlatform: async (clientId, platform) => {
    const response = await api.post(`/clients/${clientId}/social/${platform}/disconnect`);
    return response.data;
  },

  testSocialPlatform: async (clientId, platform) => {
    const response = await api.post(`/clients/${clientId}/social/${platform}/test`);
    return response.data;
  },
};

export default clientService;

