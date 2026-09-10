// Payment Handler - Manages payment processing
const payments = require('../config/payments');

class PaymentHandler {
  /**
   * Get available payment methods for a customer
   */
  getAvailableMethods() {
    const methods = [];
    if (payments.enabled.cash_dkk) methods.push('cash_dkk');
    if (payments.enabled.cash_eur) methods.push('cash_eur');
    if (payments.enabled.crypto) methods.push('crypto');
    return methods;
  }

  /**
   * Calculate total with fees
   */
  calculateWithFees(subtotal, method) {
    let fee = 0;

    if (method === 'cash_dkk' || method === 'cash_eur') {
      fee = subtotal * payments.fees[method]; // No fee for cash
    } else if (method === 'crypto') {
      fee = subtotal * payments.fees.crypto; // 1% for crypto
    }

    return parseFloat((subtotal + fee).toFixed(2));
  }

  /**
   * Convert DKK to EUR if needed
   */
  convertToEur(dkkAmount) {
    return parseFloat((dkkAmount * payments.cash_eur.exchangeRate).toFixed(2));
  }

  /**
   * Get payment method description
   */
  getMethodDescription(method) {
    const descriptions = {
      cash_dkk: '💵 Cash DKK (pickup/delivery)',
      cash_eur: '💶 Cash EUR (pickup/delivery)',
      crypto: '🪙 Crypto (' + payments.crypto.coinType + ')',
    };
    return descriptions[method] || method;
  }

  /**
   * Format payment message
   */
  formatPaymentSummary(subtotal, method) {
    const total = this.calculateWithFees(subtotal, method);
    let message = `Payment Method: ${this.getMethodDescription(method)}\n`;
    message += `Subtotal: ${subtotal.toFixed(2)} DKK\n`;

    if (method === 'cash_eur') {
      const eurAmount = this.convertToEur(subtotal);
      const eurTotal = this.convertToEur(total);
      message += `(≈ ${eurAmount.toFixed(2)} EUR)\n`;
    }

    if (method === 'crypto') {
      const fee = total - subtotal;
      message += `Fee: ${fee.toFixed(2)} DKK\n`;
    }

    message += `Total: ${total.toFixed(2)} DKK`;

    if (method === 'cash_eur') {
      const eurTotal = this.convertToEur(total);
      message += ` (≈ ${eurTotal.toFixed(2)} EUR)`;
    }

    return message;
  }

  /**
   * Get crypto payment instructions
   */
  getCryptoPaymentInfo(orderId, totalDkk) {
    if (!payments.enabled.crypto || !payments.crypto.walletAddress) {
      return null;
    }

    return {
      orderId: orderId,
      amount: totalDkk,
      coinType: payments.crypto.coinType,
      walletAddress: payments.crypto.walletAddress,
      instructions: `Please send ${totalDkk} DKK worth of ${payments.crypto.coinType} to:\n${payments.crypto.walletAddress}\n\nOrder ID: ${orderId}`,
    };
  }
}

module.exports = new PaymentHandler();