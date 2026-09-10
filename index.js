require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const menu = require('./config/menu');
const paymentHandler = require('./lib/paymentHandler');
const payments = require('./config/payments');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment variables.');
  process.exit(1);
}
if (!OWNER_CHAT_ID) {
  console.error('Missing OWNER_CHAT_ID in environment variables.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

bot.use((ctx, next) => {
  if (!ctx.session) {
    ctx.session = { cart: [], stage: null, order: {} };
  }
  return next();
});

function formatCart(cart) {
  if (cart.length === 0) return 'Your cart is empty.';
  let total = 0;
  const lines = cart.map((item, i) => {
    total += item.price;
    return (i + 1) + '. ' + item.name + ' (' + item.unit + ') - $' + item.price;
  });
  lines.push('');
  lines.push('Total: $' + total);
  return lines.join('\n');
}

function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price, 0);
}

function categoryKeyboard() {
  const buttons = Object.keys(menu).map((cat) => [
    Markup.button.callback(cat, 'cat:' + cat),
    ]);
  buttons.push([Markup.button.callback('🛒 View Cart', 'view_cart')]);
  return Markup.inlineKeyboard(buttons);
}

function itemsKeyboard(category) {
  const items = menu[category];
  const buttons = items.map((item, i) => [
    Markup.button.callback(item.name + ' - $' + item.price + '/' + item.unit, 'add:' + category + ':' + i),
    ]);
  buttons.push([Markup.button.callback('← Back to categories', 'back_to_categories')]);
  return Markup.inlineKeyboard(buttons);
}

function cartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add more items', 'back_to_categories')],
    [Markup.button.callback('✅ Checkout', 'checkout')],
    [Markup.button.callback('🗑️ Clear cart', 'clear_cart')],
    ]);
}

function paymentMethodKeyboard() {
  const methods = paymentHandler.getAvailableMethods();
  const buttons = methods.map((method) => [
    Markup.button.callback(paymentHandler.getMethodDescription(method), 'payment:' + method),
    ]);
  buttons.push([Markup.button.callback('← Back', 'back_to_categories')]);
  return Markup.inlineKeyboard(buttons);
}

function fulfillmentKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚚 Delivery', 'fulfillment:delivery')],
    [Markup.button.callback('🏪 Pickup', 'fulfillment:pickup')],
    ]);
}

bot.start((ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply('🌿 Welcome to Runtz Farm! 🌿\n\nBrowse the menu below and tap items to add them to your cart. When you are ready, hit Checkout.', categoryKeyboard());
});

bot.command('menu', (ctx) => {
  ctx.reply('📋 Menu:', categoryKeyboard());
});

bot.command('cart', (ctx) => {
  ctx.reply(formatCart(ctx.session.cart), cartKeyboard());
});

bot.command('cancel', (ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply('Order cancelled. Send /start to begin again.');
});

bot.action(/^cat:(.+)$/, (ctx) => {
  const category = ctx.match[1];
  ctx.editMessageText(category + ':', itemsKeyboard(category));
});

bot.action('back_to_categories', (ctx) => {
  ctx.editMessageText('📋 Menu:', categoryKeyboard());
});

bot.action(/^add:(.+):(\d+)$/, (ctx) => {
  const category = ctx.match[1];
  const idx = parseInt(ctx.match[2], 10);
  const item = menu[category][idx];
  ctx.session.cart.push(item);
  ctx.answerCbQuery('✅ Added ' + item.name + ' to cart');
});

bot.action('view_cart', (ctx) => {
  ctx.editMessageText(formatCart(ctx.session.cart), cartKeyboard());
});

bot.action('clear_cart', (ctx) => {
  ctx.session.cart = [];
  ctx.editMessageText('🗑️ Cart cleared.', categoryKeyboard());
});

bot.action('checkout', (ctx) => {
  if (ctx.session.cart.length === 0) {
    return ctx.answerCbQuery('Your cart is empty, add something first!');
  }
  ctx.session.stage = 'awaiting_fulfillment';
  ctx.editMessageText('How would you like your order?', fulfillmentKeyboard());
});

bot.action(/^fulfillment:(delivery|pickup)$/, (ctx) => {
  ctx.session.order.fulfillment = ctx.match[1];
  ctx.session.stage = 'awaiting_name';
  ctx.editMessageText('What name should we put on the order?');
});

function suggestedUsername(ctx) {
  return ctx.from && ctx.from.username ? ctx.from.username : null;
}

bot.on('text', async (ctx) => {
  const stage = ctx.session.stage;

  if (stage === 'awaiting_name') {
    ctx.session.order.name = ctx.message.text;
    ctx.session.stage = 'awaiting_phone';
    return ctx.reply('📱 What phone number can we reach you at?');
  }

  if (stage === 'awaiting_phone') {
    ctx.session.order.phone = ctx.message.text;
    ctx.session.stage = 'awaiting_telegram';
    const suggestion = suggestedUsername(ctx);
    const hint = suggestion ? (' We have you as @' + suggestion + ', reply that or type a different one.') : ' Please type it without the @ sign.';
    return ctx.reply('What is your Telegram username so we can message you there?' + hint);
  }

  if (stage === 'awaiting_telegram') {
    let handle = ctx.message.text.trim();
    if (handle.startsWith('@')) {
      handle = handle.slice(1);
    }
    ctx.session.order.telegramUsername = handle;
    if (ctx.session.order.fulfillment === 'delivery') {
      ctx.session.stage = 'awaiting_address';
      return ctx.reply('📍 What address should we deliver to?');
    } else {
      ctx.session.stage = 'awaiting_payment';
      return ctx.editMessageText('💳 Select a payment method:', paymentMethodKeyboard());
    }
  }

  if (stage === 'awaiting_address') {
    ctx.session.order.address = ctx.message.text;
    ctx.session.stage = 'awaiting_payment';
    return ctx.editMessageText('💳 Select a payment method:', paymentMethodKeyboard());
  }
});

bot.action(/^payment:(.+)$/, (ctx) => {
  const method = ctx.match[1];
  ctx.session.order.paymentMethod = method;

  const subtotal = getCartTotal(ctx.session.cart);
  ctx.session.order.subtotal = subtotal;
  ctx.session.order.total = paymentHandler.calculateWithFees(subtotal, method);

  ctx.session.stage = 'confirming';
  return sendConfirmation(ctx);
});

function sendConfirmation(ctx) {
  const o = ctx.session.order;
  const cart = ctx.session.cart;
  const subtotal = getCartTotal(cart);

  const summary = [
    '✅ Please confirm your order:',
    '',
    formatCart(cart),
    '',
    'Name: ' + o.name,
    'Phone: ' + o.phone,
    'Telegram: @' + o.telegramUsername,
    'Fulfillment: ' + (o.fulfillment === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'),
    o.address ? ('Address: ' + o.address) : null,
    '',
    paymentHandler.formatPaymentSummary(subtotal, o.paymentMethod),
    ].filter(Boolean).join('\n');

  return ctx.reply(summary, Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirm order', 'confirm_order')],
    [Markup.button.callback('❌ Cancel', 'cancel_order')],
    ]));
}

bot.action('cancel_order', (ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.editMessageText('Order cancelled. Send /start to begin again.');
});

bot.action('confirm_order', async (ctx) => {
  const o = ctx.session.order;
  const cart = ctx.session.cart;
  const customer = ctx.from;
  const orderId = 'ORD_' + Date.now() + '_' + customer.id;

  const ownerMessage = [
    '🎉 NEW ORDER - ' + orderId,
    '',
    formatCart(cart),
    '',
    'Name: ' + o.name,
    'Phone: ' + o.phone,
    'Telegram: @' + o.telegramUsername,
    'Fulfillment: ' + (o.fulfillment === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'),
    o.address ? ('Address: ' + o.address) : null,
    '',
    'Payment Method: ' + paymentHandler.getMethodDescription(o.paymentMethod),
    paymentHandler.formatPaymentSummary(o.subtotal, o.paymentMethod),
    '',
    'Telegram account id: ' + customer.id,
    'Telegram username: @' + (customer.username || 'N/A'),
    ].filter(Boolean).join('\n');

  try {
    await ctx.telegram.sendMessage(OWNER_CHAT_ID, ownerMessage);
  } catch (err) {
    console.error('Failed to notify owner:', err);
  }

  let customerMessage = '✅ Order placed!\n\n';
  if (o.paymentMethod === 'cash') {
    customerMessage += 'Payment: We will collect payment on ' + o.fulfillment + '.\n\n';
  } else if (o.paymentMethod === 'revolut') {
    customerMessage += 'Payment: Please send $' + o.total.toFixed(2) + ' via Revolut to @' + payments.revolut.username + ' with order ID: ' + orderId + '\n\n';
  }
  customerMessage += 'We will be in touch to confirm ' + o.fulfillment + ' details. Thanks for choosing Runtz Farm! 🌿';

  await ctx.editMessageText(customerMessage);
  ctx.session = { cart: [], stage: null, order: {} };
});

bot.launch();
console.log('🌿 Runtz Farm bot is running...');

const app = express();
app.get('/', (req, res) => res.send('Runtz Farm bot is alive.'));
app.listen(process.env.PORT || 3000, () => {
  console.log('Healthcheck server listening.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));