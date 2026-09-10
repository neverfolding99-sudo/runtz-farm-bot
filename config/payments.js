// PAYMENT CONFIGURATION
// Supported payment methods: cash, stripe, venmo, paypal

module.exports = {
  // Enable/disable payment methods
  enabled: {
    cash: true,
    stripe: process.env.STRIPE_SECRET_KEY ? true : false,
    venmo: process.env.VENMO_ENABLED ? true : false,
    paypal: process.env.PAYPAL_ENABLED ? true : false,
  },

  // Stripe configuration
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  },

  // Venmo configuration
  venmo: {
    username: process.env.VENMO_USERNAME, // Your Venmo username
  },

  // PayPal configuration
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  },

  // Fee percentage for online payments (in decimal, e.g., 0.029 = 2.9%)
  fees: {
    stripe: 0.029, // 2.9% + $0.30 per transaction (handled separately)
    paypal: 0.035, // 3.5% for online transfers
  },
};