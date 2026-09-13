// PAYMENT HANDLER — TopShelfFarm

require('dotenv').config();

module.exports = {
  getPaymentText(totalDKK) {
    const eurRate = Number(process.env.DKK_TO_EUR_RATE || 0.13);
    const totalEUR = Math.round(totalDKK * eurRate);

    let text = `💵 *Betaling*\n\n`;
    text += `DKK: *${totalDKK} kr*\n`;
    text += `EUR: *${totalEUR} €*\n\n`;

    // Crypto enabled?
    if (process.env.CRYPTO_ENABLED === "true") {
      const type = process.env.CRYPTO_TYPE || "BTC";
      const address = process.env.CRYPTO_WALLET_ADDRESS || "N/A";

      text += `🪙 *Crypto (${type})*\n`;
      text += `Adresse: \`${address}\`\n`;
      text += `Gebyr: 1%\n\n`;
    }

    // Revolut link?
    if (process.env.REVOLUT_LINK) {
      text += `💳 *Revolut betaling*\n`;
      text += `${process.env.REVOLUT_LINK}\n\n`;
    }

    text += `Vælg betalingsmetode i chatten.`;

    return text;
  }
};
