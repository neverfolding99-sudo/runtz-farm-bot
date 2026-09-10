// Payment Handler - Manages payment processing
const payments = require('../config/payments');

class PaymentHandler {
  /**
   * Get available payment methods for a customer
   */
  getAvailableMethods() {
    const methods = [];
    if (payments.enabled.cash) methods.push('cash');
    if (payments.enabled.revolut) methods.push('revolut');
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
    if (method === 'revolut') {
      fee = subtotal * payments.fees.revolut; // 1% fee
    }

    return parseFloat((subtotal + fee).toFixed(2));
  }

  /**
   * Get payment method description
   */
  getMethodDescription(method) {
    const descriptions = {
      cash: '💵 Cash on pickup/delivery',
      revolut: '💎 Revolut (@' + payments.revolut.username + ')',
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
}

module.exports = new PaymentHandler();