import api from './api';

export const adminService = {
  getSystemHealth: async () => {
    const res = await api.get('/admin/system-health');
    return res.data;
  },
};

export default adminService;
