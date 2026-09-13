

Index · JS
require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const { MongoClient } = require('mongodb');
const menu = require('./config/menu');
 
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || null;
const REVOLUT_LINK = process.env.REVOLUT_LINK || null;
const CRYPTO_ENABLED = process.env.CRYPTO_ENABLED === 'true';
const CRYPTO_WALLET_ADDRESS = process.env.CRYPTO_WALLET_ADDRESS || null;
const CRYPTO_TYPE = process.env.CRYPTO_TYPE || 'BTC';
const DRIVER_CHAT_IDS = (process.env.DRIVER_CHAT_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
 
if (!BOT_TOKEN) { console.error('Missing BOT_TOKEN'); process.exit(1); }
if (!OWNER_CHAT_ID) { console.error('Missing OWNER_CHAT_ID'); process.exit(1); }
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
 
// ─── DATABASE ────────────────────────────────────────────────────────────────
let db;
async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('runtzfarm');
  console.log('Connected to MongoDB');
}
function users() { return db.collection('users'); }
function ordersCol() { return db.collection('orders'); }
 
async function isApproved(userId) {
  if (String(userId) === String(OWNER_CHAT_ID)) return true;
  const u = await users().findOne({ userId: String(userId) });
  return u && u.status === 'approved';
}
async function isBlocked(userId) {
  const u = await users().findOne({ userId: String(userId) });
  return u && u.status === 'blocked';
}
async function setUserStatus(userId, status, displayName, handle) {
  await users().updateOne(
    { userId: String(userId) },
    { $set: { userId: String(userId), status, displayName, handle, updatedAt: new Date() } },
    { upsert: true }
  );
}
async function saveOrder(orderId, data) {
  await ordersCol().insertOne({ orderId, ...data, createdAt: new Date() });
}
async function updateOrder(orderId, update) {
  await ordersCol().updateOne({ orderId }, { $set: update });
}
async function getActiveOrders() {
  return ordersCol().find({ completed: false }).sort({ createdAt: -1 }).toArray();
}
async function getOrderById(orderId) {
  return ordersCol().findOne({ orderId });
}
 
// ─── BOT SETUP ───────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
const pendingApprovals = new Map();
 
// ─── APPROVAL SYSTEM ─────────────────────────────────────────────────────────
async function requestApproval(ctx) {
  const user = ctx.from;
  const userId = String(user.id);
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const handle = user.username ? ('@' + user.username) : 'ingen brugernavn';
  await setUserStatus(userId, 'pending', displayName, handle);
 
  await ctx.telegram.sendMessage(OWNER_CHAT_ID,
    '🔐 NY ADGANGSANMODNING\n\nNavn: ' + displayName + '\nTelegram: ' + handle + '\nID: ' + userId,
    Markup.inlineKeyboard([[
      Markup.button.callback('✅ Godkend', 'approve:' + userId),
      Markup.button.callback('❌ Afvis', 'deny:' + userId),
    ]])
  );
 
  // Change 7: Longer new customer welcome message
  await ctx.reply(
    '👋 Velkommen til TopShelfFarm!\n\n' +
    'For at beskytte vores kunder kræver vi en godkendelse, inden du kan bestille.\n\n' +
    '📨 Din adgangsanmodning er nu sendt til ejeren.\n\n' +
    'Du vil modtage en besked her på Telegram, når du er godkendt — det sker typisk hurtigt.\n\n' +
    'Har du spørgsmål i mellemtiden, er du velkommen til at kontakte os direkte.\n\n' +
    'Vi glæder os til at betjene dig! 🌿'
  );
}
 
bot.action(/^approve:(\d+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const u = await users().findOne({ userId });
  await setUserStatus(userId, 'approved', u && u.displayName, u && u.handle);
  await ctx.answerCbQuery('Bruger godkendt ✅');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ GODKENDT');
  try { await ctx.telegram.sendMessage(userId, '✅ Du er godkendt! Send /start for at begynde.'); } catch(e) {}
});
 
bot.action(/^deny:(\d+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const u = await users().findOne({ userId });
  await setUserStatus(userId, 'denied', u && u.displayName, u && u.handle);
  await ctx.answerCbQuery('Bruger afvist ❌');
  await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ AFVIST');
  try { await ctx.telegram.sendMessage(userId, '❌ Din anmodning blev afvist. Kontakt ejeren for mere info.'); } catch(e) {}
});
 
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = { cart: [], stage: null, order: {} };
  return next();
});
 
// ─── APPROVAL GATE ───────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data || '';
    if (data.startsWith('approve:') || data.startsWith('deny:')) return next();
  }
  const userId = String(ctx.from && ctx.from.id);
  if (userId === String(OWNER_CHAT_ID)) return next();
  if (await isBlocked(userId)) return ctx.reply('Du har ikke adgang til denne bot.');
  if (await isApproved(userId)) return next();
  if (!pendingApprovals.has(userId)) { pendingApprovals.set(userId, true); await requestApproval(ctx); }
  else await ctx.reply('⏳ Din anmodning afventer stadig godkendelse fra ejeren.');
});
 
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatCart(cart) {
  if (!cart.length) return 'Din kurv er tom.';
  let total = 0;
  const lines = cart.map((item, i) => {
    total += item.price;
    return (i + 1) + '. ' + item.name + ' (' + item.unit + ') — ' + item.price + ' kr.';
  });
  return lines.join('\n') + '\n\n💰 Total: ' + total + ' kr.';
}
function cartTotal(cart) { return cart.reduce((s, i) => s + i.price, 0); }
 
function categoryText(cat) {
  return cat + ':\n\n' + menu[cat].map((item, i) =>
    (i + 1) + '. ' + item.name + (item.price > 0 ? ' — ' + item.price + ' kr./' + item.unit : '') + '\n' + item.description
  ).join('\n\n');
}
 
// Change 8: "Til kassen" button in category keyboard
function categoryKeyboard() {
  const btns = Object.keys(menu).map(cat => [Markup.button.callback(cat, 'cat:' + cat)]);
  btns.push([
    Markup.button.callback('🛒 Se kurv', 'view_cart'),
    Markup.button.callback('✅ Til kassen', 'checkout'),
  ]);
  return Markup.inlineKeyboard(btns);
}
 
function itemsKeyboard(cat) {
  const btns = menu[cat].map((item, i) => [
    Markup.button.callback(
      item.price > 0 ? item.name + ' — ' + item.price + ' kr./' + item.unit : '⏳ ' + item.name,
      'add:' + cat + ':' + i
    )
  ]);
  btns.push([Markup.button.callback('⬅️ Tilbage til kategorier', 'back_to_categories')]);
  return Markup.inlineKeyboard(btns);
}
 
// Change 5: Cart with individual remove buttons
function cartItemsKeyboard(cart) {
  const btns = cart.map((item, i) => [
    Markup.button.callback('❌ Fjern: ' + item.name, 'remove:' + i),
  ]);
  btns.push([Markup.button.callback('➕ Tilføj flere varer', 'back_to_categories')]);
  btns.push([Markup.button.callback('✅ Til kassen', 'checkout')]);
  btns.push([Markup.button.callback('🗑️ Ryd kurv', 'clear_cart')]);
  return Markup.inlineKeyboard(btns);
}
 
function paymentLabel(o) {
  if (o.payment === 'revolut') return '📱 Revolut Pay';
  if (o.payment === 'crypto') return '🪙 Krypto (' + CRYPTO_TYPE + ')';
  if (o.payment === 'mobilepay') return '📲 MobilePay';
  return '💵 Kontant ved ' + (o.fulfillment === 'delivery' ? 'levering' : 'afhentning');
}
 
function dayLabel(o) {
  if (o.day === 'today') return 'I dag';
  if (o.day === 'tomorrow') return 'I morgen';
  if (o.day === 'day_after') return 'Overmorgen';
  return o.day; // custom date
}
 
// ─── ADMIN COMMANDS ───────────────────────────────────────────────────────────
bot.command('approved', async (ctx) => {
  if (String(ctx.from.id) !== String(OWNER_CHAT_ID)) return;
  const list = await users().find({ status: 'approved' }).toArray();
  if (!list.length) return ctx.reply('Ingen godkendte brugere endnu.');
  const lines = list.map((u, i) => (i + 1) + '. ' + (u.displayName || '?') + ' ' + (u.handle || '') + ' [' + u.userId + ']');
  ctx.reply('✅ Godkendte brugere:\n\n' + lines.join('\n'));
});
 
bot.command('block', async (ctx) => {
  if (String(ctx.from.id) !== String(OWNER_CHAT_ID)) return;
  const userId = ctx.message.text.split(' ')[1];
  if (!userId) return ctx.reply('Brug: /block <userId>');
  const u = await users().findOne({ userId });
  await setUserStatus(userId, 'blocked', u && u.displayName, u && u.handle);
  ctx.reply('🚫 Bruger ' + userId + ' er nu blokeret.');
  try { await ctx.telegram.sendMessage(userId, 'Du er blevet blokeret fra denne bot.'); } catch(e) {}
});
 
bot.command('unblock', async (ctx) => {
  if (String(ctx.from.id) !== String(OWNER_CHAT_ID)) return;
  const userId = ctx.message.text.split(' ')[1];
  if (!userId) return ctx.reply('Brug: /unblock <userId>');
  const u = await users().findOne({ userId });
  await setUserStatus(userId, 'approved', u && u.displayName, u && u.handle);
  ctx.reply('✅ Bruger ' + userId + ' er godkendt igen.');
  try { await ctx.telegram.sendMessage(userId, '✅ Du har fået adgang igen. Send /start.'); } catch(e) {}
});
 
bot.command('orders', async (ctx) => {
  if (String(ctx.from.id) !== String(OWNER_CHAT_ID)) return;
  const active = await getActiveOrders();
  if (!active.length) return ctx.reply('Ingen aktive ordrer.');
  const lines = active.map(o =>
    '📦 Ordre ' + o.orderId + '\nMetode: ' + (o.fulfillment === 'delivery' ? '🚗 Levering' : '🏬 Afhentning') +
    ' — ' + o.total + ' kr.\nKunde: ' + o.customerName + '\nStatus: ' + (o.completed ? '✅ Fuldfort' : o.claimedBy ? '🚗 Taget af ' + o.claimedBy : '⏳ Venter')
  );
  ctx.reply('Aktive ordrer:\n\n' + lines.join('\n\n'));
});
 
bot.command('mystatus', async (ctx) => {
  const userId = String(ctx.from.id);
  const order = await ordersCol().findOne({ customerId: userId, completed: false }, { sort: { createdAt: -1 } });
  if (!order) return ctx.reply('Du har ingen aktive ordrer.');
  let status = '⏳ Venter på bekræftelse';
  if (order.completed) status = '✅ Fuldfort';
  else if (order.claimedBy) status = '🚗 På vej — taget af ' + order.claimedBy;
  ctx.reply('Din seneste ordre (' + order.orderId + '):\n' + formatCart(order.cart) + '\n\nStatus: ' + status);
});
 
// ─── COMMANDS ────────────────────────────────────────────────────────────────
bot.command('groupid', ctx => ctx.reply('Chat id: ' + ctx.chat.id));
 
// Change 1: Welcome message TopShelfFarm
bot.start(ctx => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply(
    '👋 Velkommen til TopShelfFarm! 🌿\n\nBrowse vores menu og tryk på en vare for at tilføje den til kurven.\n\nNår du er klar, tryk ✅ Til kassen.',
    categoryKeyboard()
  );
});
 
bot.command('menu', ctx => ctx.reply('📋 Menu:', categoryKeyboard()));
 
// Change 8: /cart shows empty message
bot.command('cart', ctx => {
  const cart = ctx.session.cart;
  if (!cart.length) return ctx.reply('🛒 Din kurv er tom.\n\nTilføj en vare for at fortsætte.', categoryKeyboard());
  ctx.reply(formatCart(cart) + '\n\n❌ Tryk på en vare herunder for at fjerne den.', cartItemsKeyboard(cart));
});
 
bot.command('cancel', ctx => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply('❌ Annulleret. Send /start for at begynde igen.');
});
 
// ─── MENU NAVIGATION ─────────────────────────────────────────────────────────
bot.action(/^cat:(.+)$/, ctx => ctx.editMessageText(categoryText(ctx.match[1]), itemsKeyboard(ctx.match[1])));
bot.action('back_to_categories', ctx => ctx.editMessageText('📋 Menu:', categoryKeyboard()));
 
// Change 5+6: Add item with navigation, block KOMMER SNART
bot.action(/^add:(.+):(\d+)$/, ctx => {
  const cat = ctx.match[1];
  const item = menu[cat][parseInt(ctx.match[2], 10)];
 
  if (item.price === 0) {
    return ctx.answerCbQuery('⏳ Denne vare kommer snart — hold øjnene åbne!');
  }
 
  ctx.session.cart.push(item);
  const total = cartTotal(ctx.session.cart);
  const count = ctx.session.cart.length;
 
  ctx.answerCbQuery('✅ ' + item.name + ' tilføjet!');
  ctx.editMessageText(
    '✅ *' + item.name + '* tilføjet til kurven!\n\n' +
    '🛒 ' + count + ' vare' + (count === 1 ? '' : 'r') + ' — ' + total + ' kr.\n\nHvad vil du gerne gøre nu?',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Tilføj mere fra ' + cat, 'cat:' + cat)],
        [Markup.button.callback('🏷️ Se alle kategorier', 'back_to_categories')],
        [Markup.button.callback('🛒 Se kurv', 'view_cart')],
        [Markup.button.callback('✅ Til kassen', 'checkout')],
      ]),
    }
  );
});
 
// Change 8: view_cart with empty message
bot.action('view_cart', ctx => {
  const cart = ctx.session.cart;
  if (!cart.length) return ctx.editMessageText('🛒 Din kurv er tom.\n\nTilføj en vare for at fortsætte.', categoryKeyboard());
  ctx.editMessageText(formatCart(cart) + '\n\n❌ Tryk på en vare herunder for at fjerne den.', cartItemsKeyboard(cart));
});
 
bot.action('clear_cart', ctx => {
  ctx.session.cart = [];
  ctx.editMessageText('🗑️ Kurv ryddet.', categoryKeyboard());
});
 
// Change 5: Remove individual items
bot.action(/^remove:(\d+)$/, ctx => {
  const idx = parseInt(ctx.match[1], 10);
  const cart = ctx.session.cart;
  if (idx >= 0 && idx < cart.length) {
    const removed = cart.splice(idx, 1)[0];
    ctx.answerCbQuery('❌ ' + removed.name + ' fjernet');
  }
  if (!cart.length) {
    ctx.editMessageText('🛒 Din kurv er tom.\n\nTilføj en vare for at fortsætte.', categoryKeyboard());
  } else {
    ctx.editMessageText(formatCart(cart) + '\n\n❌ Tryk på en vare herunder for at fjerne den.', cartItemsKeyboard(cart));
  }
});
 
// ─── CHECKOUT ────────────────────────────────────────────────────────────────
// Change 8+9: Proper empty cart message + info reminder
bot.action('checkout', ctx => {
  if (!ctx.session.cart.length) {
    return ctx.editMessageText('🛒 Din kurv er tom!\n\nTilføj mindst én vare, før du kan gå til kassen.', categoryKeyboard());
  }
  ctx.session.stage = 'awaiting_fulfillment';
  // Change 9: Important info reminder
  ctx.editMessageText(
    '📋 *Vigtigt inden du bestiller:*\n\n' +
    'Sørg for at udfylde korrekte oplysninger:\n' +
    '✅ Rigtigt fulde navn\n' +
    '✅ Gyldigt telefonnummer\n' +
    '✅ Korrekt adresse (ved levering)\n' +
    '✅ Ønsket tidspunkt\n\n' +
    '⚠️ Forkerte oplysninger kan forsinke eller annullere din ordre.\n\n' +
    'Hvordan vil du gerne have din ordre?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🚗 Levering', 'fulfillment:delivery')],
      [Markup.button.callback('🏬 Afhentning', 'fulfillment:pickup')],
    ])
  );
});
 
bot.action(/^fulfillment:(delivery|pickup)$/, ctx => {
  ctx.session.order.fulfillment = ctx.match[1];
  ctx.session.stage = 'awaiting_name';
  ctx.editMessageText('👤 Hvad er dit fulde navn?');
});
 
// Change 10: More day options
function askTiming(ctx) {
  ctx.session.stage = 'awaiting_timing';
  return ctx.reply('📅 Hvornår vil du gerne have din ordre?', Markup.inlineKeyboard([
    [Markup.button.callback('🌟 I dag', 'timing:today'), Markup.button.callback('🌙 I morgen', 'timing:tomorrow')],
    [Markup.button.callback('📆 Overmorgen', 'timing:day_after'), Markup.button.callback('📝 Anden dato', 'timing:custom')],
  ]));
}
 
bot.action(/^timing:(today|tomorrow|day_after)$/, ctx => {
  ctx.session.order.day = ctx.match[1];
  ctx.session.stage = 'awaiting_time';
  const d = { today: 'i dag', tomorrow: 'i morgen', day_after: 'overmorgen' }[ctx.match[1]];
  return ctx.editMessageText('⏰ Perfekt, ' + d + '. Hvilket klokkeslæt passer dig? (f.eks. 16:00)');
});
 
bot.action('timing:custom', ctx => {
  ctx.session.order.day = null;
  ctx.session.stage = 'awaiting_custom_date';
  return ctx.editMessageText('📝 Skriv den ønskede dato (f.eks. 15/1 eller mandag 20/1):');
});
 
// Change 11: More payment options
function askPayment(ctx) {
  ctx.session.stage = 'awaiting_payment';
  const da = ctx.session.order.fulfillment === 'delivery' ? 'levering' : 'afhentning';
  const btns = [
    [Markup.button.callback('💵 Kontant ved ' + da, 'payment:cash_dkk')],
    [Markup.button.callback('📱 Revolut', 'payment:revolut'), Markup.button.callback('📲 MobilePay', 'payment:mobilepay')],
    [Markup.button.callback('🪙 Krypto (' + CRYPTO_TYPE + ')', 'payment:crypto')],
  ];
  return ctx.reply('💳 Hvordan vil du gerne betale?', Markup.inlineKeyboard(btns));
}
 
bot.action(/^payment:(cash_dkk|revolut|crypto|mobilepay)$/, ctx => {
  ctx.session.order.payment = ctx.match[1];
  ctx.session.stage = 'confirming';
  return sendConfirmation(ctx);
});
 
// ─── TEXT INPUT ───────────────────────────────────────────────────────────────
bot.on('text', async ctx => {
  const s = ctx.session.stage;
 
  if (s === 'awaiting_name') {
    ctx.session.order.name = ctx.message.text;
    ctx.session.stage = 'awaiting_phone';
    return ctx.reply('📱 Hvad er dit telefonnummer?');
  }
  if (s === 'awaiting_phone') {
    ctx.session.order.phone = ctx.message.text;
    ctx.session.stage = 'awaiting_telegram';
    const hint = ctx.from.username ? ' Din er @' + ctx.from.username + ' — svar det, eller skriv et andet.' : ' Skriv uden @ tegnet.';
    return ctx.reply('💬 Hvad er dit Telegram-brugernavn?' + hint);
  }
  if (s === 'awaiting_telegram') {
    let h = ctx.message.text.trim();
    if (h.startsWith('@')) h = h.slice(1);
    ctx.session.order.telegramUsername = h;
    if (ctx.session.order.fulfillment === 'delivery') {
      ctx.session.stage = 'awaiting_address';
      return ctx.reply('🏠 Hvilken adresse skal vi levere til?\n\n(Husk husnummer og evt. etage)');
    }
    return askTiming(ctx);
  }
  if (s === 'awaiting_address') {
    ctx.session.order.address = ctx.message.text;
    return askTiming(ctx);
  }
  if (s === 'awaiting_custom_date') {
    ctx.session.order.day = ctx.message.text;
    ctx.session.stage = 'awaiting_time';
    return ctx.reply('⏰ Hvilket klokkeslæt passer dig den dag? (f.eks. 16:00)');
  }
  if (s === 'awaiting_time') {
    ctx.session.order.time = ctx.message.text;
    return askPayment(ctx);
  }
});
 
// ─── CONFIRMATION ─────────────────────────────────────────────────────────────
function sendConfirmation(ctx) {
  const o = ctx.session.order;
  const lines = [
    '📋 Bekræft din ordre:',
    '',
    formatCart(ctx.session.cart),
    '',
    '👤 Navn: ' + o.name,
    '📱 Telefon: ' + o.phone,
    '💬 Telegram: @' + o.telegramUsername,
    '📦 Metode: ' + (o.fulfillment === 'delivery' ? '🚗 Levering' : '🏬 Afhentning'),
  ];
  if (o.address) lines.push('🏠 Adresse: ' + o.address);
  lines.push('📅 Tidspunkt: ' + dayLabel(o) + ' kl. ' + o.time);
  lines.push('', '💳 Betaling: ' + paymentLabel(o));
  return ctx.reply(lines.join('\n'), Markup.inlineKeyboard([
    [Markup.button.callback('✅ Bekræft ordre', 'confirm_order')],
    [Markup.button.callback('❌ Annuller', 'cancel_order')],
  ]));
}
 
bot.action('cancel_order', ctx => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.editMessageText('❌ Ordre annulleret.\n\nSend /start for at begynde igen.');
});
 
// ─── ORDER BROADCAST ──────────────────────────────────────────────────────────
async function broadcastOrder(ctx, orderId, text, keyboard) {
  const targets = [OWNER_CHAT_ID];
  if (GROUP_CHAT_ID) targets.push(GROUP_CHAT_ID);
  if (ctx.session.order.fulfillment === 'delivery') for (const id of DRIVER_CHAT_IDS) targets.push(id);
  const refs = [];
  for (const chatId of targets) {
    try {
      const sent = await ctx.telegram.sendMessage(chatId, text, keyboard);
      refs.push({ chatId: sent.chat.id, messageId: sent.message_id });
    } catch(err) { console.error('Failed:', err.message); }
  }
  return refs;
}
 
bot.action('confirm_order', async ctx => {
  const o = ctx.session.order;
  const cart = ctx.session.cart;
  const total = cartTotal(cart);
  const orderId = 'o' + Date.now();
  const customerId = String(ctx.from.id);
 
  const orderLines = [
    '📦 NY ' + (o.fulfillment === 'delivery' ? '🚗 LEVERING' : '🏬 AFHENTNING'),
    '',
    formatCart(cart),
    '',
    '👤 Navn: ' + o.name,
    '📱 Telefon: ' + o.phone,
    '💬 Telegram: @' + o.telegramUsername,
    '📦 Metode: ' + (o.fulfillment === 'delivery' ? 'Levering' : 'Afhentning'),
  ];
  if (o.address) orderLines.push('🏠 Adresse: ' + o.address);
  orderLines.push(
    '📅 Tidspunkt: ' + dayLabel(o) + ' kl. ' + o.time,
    '💳 Betaling: ' + paymentLabel(o),
    '',
    '🆔 Telegram ID: ' + customerId,
    '🔖 Ordre ID: ' + orderId
  );
  const orderText = orderLines.join('\n');
 
  const refs = await broadcastOrder(ctx, orderId, orderText,
    Markup.inlineKeyboard([[Markup.button.callback('🚗 Tag ordre', 'claim:' + orderId)]])
  );
 
  await saveOrder(orderId, {
    customerId, customerName: o.name, cart, total,
    fulfillment: o.fulfillment, address: o.address || null,
    day: o.day, time: o.time, payment: o.payment,
    telegramUsername: o.telegramUsername, phone: o.phone,
    orderText, refs, claimedBy: null, completed: false
  });
 
  const da = o.fulfillment === 'delivery' ? 'levering' : 'afhentning';
  let msg = '✅ Ordre modtaget!\n\nVi kontakter dig om ' + da + ' ' + dayLabel(o).toLowerCase() + ' kl. ' + o.time + '.\n\nTak fordi du valgte TopShelfFarm! 🌿\n\nBrug /mystatus for at se status på din ordre.';
  if (o.payment === 'revolut' && REVOLUT_LINK) msg += '\n\n📱 Betal via Revolut: ' + REVOLUT_LINK;
  if (o.payment === 'mobilepay') msg += '\n\n📲 Send betaling til vores MobilePay. Vi kontakter dig med detaljer.';
  if (o.payment === 'crypto' && CRYPTO_WALLET_ADDRESS) msg += '\n\n🪙 Send ' + CRYPTO_TYPE + ' til:\n' + CRYPTO_WALLET_ADDRESS + '\nTotal: ' + total + ' kr.';
  await ctx.editMessageText(msg);
  ctx.session = { cart: [], stage: null, order: {} };
});
 
// ─── CLAIM / COMPLETE ─────────────────────────────────────────────────────────
bot.action(/^claim:(.+)$/, async ctx => {
  const orderId = ctx.match[1];
  const order = await getOrderById(orderId);
  if (!order) return ctx.answerCbQuery('Ordre ikke fundet.');
  if (order.claimedBy) return ctx.answerCbQuery('Taget af ' + order.claimedBy);
  const staffer = ctx.from.first_name || ctx.from.username || 'Ukendt';
  await updateOrder(orderId, { claimedBy: staffer });
  const newText = order.orderText + '\n\n🚗 Taget af: ' + staffer;
  for (const ref of order.refs) {
    try { await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, newText, Markup.inlineKeyboard([[Markup.button.callback('✅ Leveret/Afhentet', 'complete:' + orderId)]])); } catch(e) {}
  }
  try { await ctx.telegram.sendMessage(order.customerId, '🚗 Din ordre er på vej! Brug /mystatus for opdatering.'); } catch(e) {}
  ctx.answerCbQuery('Du har taget ordren! 🚗');
});
 
bot.action(/^complete:(.+)$/, async ctx => {
  const orderId = ctx.match[1];
  const order = await getOrderById(orderId);
  if (!order) return ctx.answerCbQuery('Ordre ikke fundet.');
  if (order.completed) return ctx.answerCbQuery('Allerede fuldfort.');
  const staffer = ctx.from.first_name || ctx.from.username || 'Ukendt';
  await updateOrder(orderId, { completed: true, completedBy: staffer, completedAt: new Date() });
  const base = order.claimedBy ? (order.orderText + '\n\n🚗 Taget af: ' + order.claimedBy) : order.orderText;
  for (const ref of order.refs) {
    try { await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, base + '\n\n✅ Fuldfort af: ' + staffer); } catch(e) {}
  }
  try { await ctx.telegram.sendMessage(order.customerId, '✅ Din ordre er leveret/afhentet! Tak fordi du handlede hos TopShelfFarm. 🌿'); } catch(e) {}
  ctx.answerCbQuery('✅ Fuldfort!');
});
 
// ─── LAUNCH ───────────────────────────────────────────────────────────────────
connectDB().then(() => {
  bot.launch();
  console.log('TopShelfFarm bot is running...');
}).catch(err => { console.error('DB connection failed:', err); process.exit(1); });
 
const app = express();
app.get('/', (req, res) => res.send('TopShelfFarm bot is alive.'));
app.listen(process.env.PORT || 3000);
 
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
 
// Self-ping to prevent Render sleep
const https = require('https');
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://runtz-farm-bot.onrender.com';
setInterval(() => { https.get(SELF_URL, r => { r.resume(); }).on('error', () => {}); }, 10 * 60 * 1000);
 
This file type cannot be opened.
