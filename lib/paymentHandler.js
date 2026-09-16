require('dotenv').config();

module.exports = {
  getPaymentText(totalDKK) {
    let text = 'Betaling' + nl + nl + 'Total: ' + totalDKK + ' kr' + nl + nl;
    if (process.env.CRYPTO_ENABLED === 'true') {
      const type = process.env.CRYPTO_TYPE || 'BTC';
      const address = process.env.CRYPTO_WALLET_ADDRESS || 'N/A';
      text += 'Crypto (' + type + ')' + nl + 'Adresse: ' + address + nl + 'Gebyr: 1%' + nl + nl;
    }
    if (process.env.REVOLUT_LINK) {
      text += 'Revolut betaling' + nl + process.env.REVOLUT_LINK + nl + nl;
    }
    text += 'Vaelg betalingsmetode i chatten.';
    return text;
  }
};
