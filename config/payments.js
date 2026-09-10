// PAYMENT CONFIGURATION
// Supported payment methods: cash, revolut

module.exports = {
  // Enable/disable payment methods
  enabled: {
    cash: true,
    revolut: process.env.REVOLUT_ENABLED ? true : false,
  },

  // Revolut configuration
  revolut: {
    username: process.env.REVOLUT_USERNAME, // Your Revolut username/handle
  },

  // Fee percentage for Revolut payments (in decimal, e.g., 0.01 = 1%)
  fees: {
    revolut: 0.01, // 1% for Revolut transfers (adjust as needed)
  },
};