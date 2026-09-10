// Payment Handler - Manages payment processing
const Stripe = require('stripe');
const payments = require('../config/payments');

class PaymentHandler {
  constructor() {
    if (payments.enabled.stripe && payments.stripe.secretKey) {
      this.stripe = new Stripe(payments.stripe.secretKey);
    }
  }

  /**
   * Get available payment methods for a customer
   */
  getAvailableMethods() {
    const methods = [];
    if (payments.enabled.cash) methods.push('cash');
    if (payments.enabled.stripe) methods.push('stripe');
    if (payments.enabled.venmo) methods.push('venmo');
    if (payments.enabled.paypal) methods.push('paypal');
    return methods;
  }

  /**
   * Calculate total with fees
   */
  calculateWithFees(subtotal, method) {
    if (method === 'cash') {
      return subtotal;
    }

    let fee = 0;
    if (method === 'stripe') {
      fee = subtotal * payments.fees.stripe + 0.30; // 2.9% + $0.30
    } else if (method === 'paypal') {
      fee = subtotal * payments.fees.paypal;
    }

    return parseFloat((subtotal + fee).toFixed(2));
  }

  /**
   * Get payment method description
   */
  getMethodDescription(method) {
    const descriptions = {
      cash: '💵 Cash on pickup/delivery',
      stripe: '💳 Card (Stripe)',
      venmo: '📱 Venmo (@' + payments.venmo.username + ')',
      paypal: '🅿️ PayPal',
    };
    return descriptions[method] || method;
  }

  /**
   * Format payment message
   */
  formatPaymentSummary(subtotal, method) {
    const total = this.calculateWithFees(subtotal, method);
    let message = `Payment Method: ${this.getMethodDescription(method)}\n`;
    message += `Subtotal: $${subtotal.toFixed(2)}\n`;

    if (method !== 'cash') {
      const fee = total - subtotal;
      message += `Fee: $${fee.toFixed(2)}\n`;
    }

    message += `Total: $${total.toFixed(2)}`;
    return message;
  }

  /**
   * Create Stripe payment link (for future integration)
   */
  async createStripePaymentLink(orderId, amount, description) {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    try {
      const link = await this.stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: description,
              },
              unit_amount: Math.round(amount * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        after_completion: {
          type: 'redirect',
          redirect: {
            url: process.env.PAYMENT_SUCCESS_URL || 'https://example.com/success',
          },
        },
        metadata: {
          orderId: orderId,
        },
      });

      return link.url;
    } catch (error) {
      console.error('Error creating Stripe payment link:', error);
      throw error;
    }
  }
}

module.exports = new PaymentHandler();