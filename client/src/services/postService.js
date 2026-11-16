import api from './api';

export const postService = {
  getPosts: async (params = {}) => {
    const response = await api.get('/posts', { params });
    return response.data;
  },

  getPostById: async (id) => {
    const response = await api.get(`/posts/${id}`);
    return response.data;
  },

  createPost: async (postData) => {
    const isFormData = postData instanceof FormData;
    const response = await api.post('/posts', postData, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {},
    });
    return response.data;
  },

  revisePost: async (id, postData) => {
    const isFormData = postData instanceof FormData;
    const response = await api.put(`/posts/${id}/revise`, postData, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {},
    });
    return response.data;
  },

  submitPost: async (id) => {
    const response = await api.post(`/posts/${id}/submit`);
    return response.data;
  },

  submitForReview: async (id) => {
    const response = await api.post(`/posts/${id}/submit`);
    return response.data;
  },

  managerReview: async (id, reviewData) => {
    const response = await api.post(`/posts/${id}/manager-review`, reviewData);
    return response.data;
  },

  adminReview: async (id, reviewData) => {
    const response = await api.post(`/posts/${id}/admin-review`, reviewData);
    return response.data;
  },

  selectPlatform: async (id, platform) => {
    const response = await api.put(`/posts/${id}/platform`, { platform });
    return response.data;
  },

  updatePlatform: async (id, platform) => {
    const response = await api.put(`/posts/${id}/platform`, { platform });
    return response.data;
  },

  updatePublishUrl: async (id, manual_publish_url) => {
    const response = await api.put(`/posts/${id}/publish-url`, { manual_publish_url });
    return response.data;
  },

  getAiStatus: async (id) => {
    const response = await api.get(`/posts/${id}/ai-status`);
    return response.data;
  },

  checkImage: async (id) => {
    const response = await api.post(`/posts/${id}/check-image`);
    return response.data;
  },

  checkText: async (id) => {
    const response = await api.post(`/posts/${id}/check-text`);
    return response.data;
  },
};

export default postService;
