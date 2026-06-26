// Mock manuel pour Jest (le paquet réel est ESM-only)
module.exports = {
  wrapper: (axiosInstance) => axiosInstance,
};
