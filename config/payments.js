// PAYMENT CONFIGURATION
// Supported payment methods: cash_dkk, cash_eur, crypto

module.exports = {
  // Enable/disable payment methods
  enabled: {
    cash_dkk: true,
    cash_eur: true,
    crypto: process.env.CRYPTO_ENABLED ? true : false,
  },

  // Cash DKK configuration
  cash_dkk: {
    currency: 'DKK',
  },

  // Cash EUR configuration
  cash_eur: {
    currency: 'EUR',
    exchangeRate: parseFloat(process.env.DKK_TO_EUR_RATE || '0.13'), // Default rate
  },

  // Crypto configuration
  crypto: {
    enabled: process.env.CRYPTO_ENABLED ? true : false,
    walletAddress: process.env.CRYPTO_WALLET_ADDRESS, // Your crypto wallet address
    coinType: process.env.CRYPTO_TYPE || 'BTC', // BTC, ETH, etc.
  },

  // Fee percentages (in decimal, e.g., 0.02 = 2%)
  fees: {
    cash_dkk: 0, // No fee for cash DKK
    cash_eur: 0, // No fee for cash EUR
    crypto: 0.01, // 1% for crypto
  },
};