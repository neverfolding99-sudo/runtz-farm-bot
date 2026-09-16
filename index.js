require('dotenv').config();
const nl = '\n';
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const { MongoClient } = require('mongodb');
const https = require('https');
const menu = require('./config/menu');
const payment = require('./lib/paymentHandler');

// EXPRESS
const app = express();
app.get('/', (req, res) => res.send('TopShelfFarm Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Express server on port ' + PORT));

// Self-ping every 10 min
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://runtz-farm-bot.onrender.com';
setInterval(() => {
  https.get(SELF_URL, (res) => { console.log('Self-ping:', res.statusCode); }).on('error', (e) => { console.error('Self-ping error:', e.message); });
}, 10 * 60 * 1000);

// BOT
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session({ defaultSession: () => ({ cart: [], step: null, order: {} }) }));

// MONGODB
const client = new MongoClient(process.env.MONGODB_URI);
let ordersCollection;
let approvedCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db('runtzfarm');
    ordersCollection = db.collection('orders');
    approvedCollection = db.collection('approved_users');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB error:', err);
    setTimeout(connectDB, 5000);
  }
}
connectDB();

function reset(ctx) { ctx.session = { cart: [], step: null, order: {} }; }

async function isApproved(userId) {
  try { return !!(await approvedCollection.findOne({ userId: String(userId) })); }
  catch (e) { return false; }
}

// GLOBAL ERROR HANDLER
bot.catch((err, ctx) => { console.error('Bot error for update', ctx && ctx.updateType, ':', err.message); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason && reason.message); });

// APPROVAL GATE
bot.use(async (ctx, next) => {
  const userId = ctx.from && ctx.from.id;
  if (!userId) return next();
  const ownerId = String(process.env.OWNER_CHAT_ID);
  if (String(userId) === ownerId) return next();
  const cb = (ctx.callbackQuery && ctx.callbackQuery.data) || '';
  if (cb.startsWith('APPROVE_') || cb.startsWith('DENY_')) return next();
  if (await isApproved(userId)) return next();
  if (ctx.message && ctx.message.text === '/start') return next();
  return ctx.reply('Din adgang afventer godkendelse. Vent venligst.');
});

// START
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const ownerId = String(process.env.OWNER_CHAT_ID);
  if (String(userId) === ownerId || await isApproved(userId)) {
    reset(ctx);
    return ctx.reply('Velkommen til TopShelfFarm. Tryk Menu.', Markup.keyboard([['Menu'], ['Kurv', 'Annuller']]).resize());
  }
  const username = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
  await ctx.reply('Din adgang afventer godkendelse. Ejeren er notificeret.');
  try {
    await bot.telegram.sendMessage(ownerId,
      'Ny bruger anmoder om adgang' + nl + 'Navn: ' + ctx.from.first_name + ' ' + (ctx.from.last_name || '') + nl + 'Username: ' + username + nl + 'ID: ' + userId,
      Markup.inlineKeyboard([[Markup.button.callback('GODKEND', 'APPROVE_' + userId)],[Markup.button.callback('AFVIS', 'DENY_' + userId)]])
    );
  } catch(e) { console.error('notify owner failed:', e.message); }
});

// APPROVE / DENY
bot.action(/APPROVE_(\d+)/, async (ctx) => {
  const userId = String(ctx.match[1]);
  await approvedCollection.updateOne({ userId }, { $set: { userId, approvedAt: new Date() } }, { upsert: true });
  await ctx.editMessageText('Bruger ' + userId + ' er godkendt.');
  try { await bot.telegram.sendMessage(userId, 'Du er godkendt! Skriv /start for at begynde.'); } catch(e) {}
});

bot.action(/DENY_(\d+)/, async (ctx) => {
  const userId = String(ctx.match[1]);
  await ctx.editMessageText('Bruger ' + userId + ' er afvist.');
  try { await bot.telegram.sendMessage(userId, 'Din adgang er afvist.'); } catch(e) {}
});

// MENU
bot.hears('Menu', (ctx) => {
  ctx.reply('Vaelg kategori:', Markup.inlineKeyboard(Object.keys(menu).map((cat) => [Markup.button.callback(cat, 'CAT_' + cat)])));
});

bot.action(/CAT_(.+)/, (ctx) => {
  const cat = ctx.match[1];
  ctx.reply(cat + ':', Markup.inlineKeyboard(menu[cat].map((item, i) => [Markup.button.callback(item.name + ' - ' + item.price + ' kr (' + item.unit + ')', 'ITEM_' + cat + '_' + i)])));
});

bot.action(/ITEM_(.+)_(\d+)/, (ctx) => {
  const item = menu[ctx.match[1]][Number(ctx.match[2])];
  if (!ctx.session.cart) ctx.session.cart = [];
  ctx.session.cart.push(item);
  ctx.reply('Tilfojet: ' + item.name + ' - ' + item.price + ' kr', Markup.keyboard([['Menu'], ['Kurv', 'Annuller']]).resize());
});

// CART
bot.hears('Kurv', (ctx) => {
  if (!ctx.session.cart || !ctx.session.cart.length) return ctx.reply('Kurven er tom.');
  const total = ctx.session.cart.reduce((s, i) => s + i.price, 0);
  let txt = 'Din kurv:' + nl + nl;
  ctx.session.cart.forEach((item, i) => { txt += (i+1) + '. ' + item.name + ' - ' + item.price + ' kr' + nl; });
  txt += nl + 'Total: ' + total + ' kr';
  ctx.reply(txt, Markup.inlineKeyboard([[Markup.button.callback('Bekraeft ordre', 'STEP_DELIVERY')],[Markup.button.callback('Ryd kurv', 'CLEAR_CART')]]));
});

bot.action('CLEAR_CART', (ctx) => { ctx.session.cart = []; ctx.reply('Kurven er ryddet.'); });

// CHECKOUT
bot.action('STEP_DELIVERY', (ctx) => {
  ctx.session.step = 'delivery_choice';
  ctx.reply('Levering eller afhentning?', Markup.inlineKeyboard([[Markup.button.callback('Levering', 'DELIVERY')],[Markup.button.callback('Afhentning', 'PICKUP')]]));
});

bot.action('DELIVERY', (ctx) => { ctx.session.order.delivery = 'delivery'; ctx.session.step = 'name'; ctx.reply('Skriv dit navn:'); });
bot.action('PICKUP', (ctx) => { ctx.session.order.delivery = 'pickup'; ctx.session.step = 'name'; ctx.reply('Skriv dit navn:'); });

bot.on('text', async (ctx) => {
  if (!ctx.session) return;
  if (ctx.session.step === 'name') { ctx.session.order.name = ctx.message.text; ctx.session.step = 'phone'; return ctx.reply('Skriv telefonnummer:'); }
  if (ctx.session.step === 'phone') {
    ctx.session.order.phone = ctx.message.text;
    if (ctx.session.order.delivery === 'delivery') { ctx.session.step = 'address'; return ctx.reply('Skriv leveringsadresse:'); }
    ctx.session.step = 'payment'; return ctx.reply('Vaelg betaling:', paymentButtons());
  }
  if (ctx.session.step === 'address') { ctx.session.order.address = ctx.message.text; ctx.session.step = 'payment'; return ctx.reply('Vaelg betaling:', paymentButtons()); }
});

function paymentButtons() {
  return Markup.inlineKeyboard([[Markup.button.callback('Kontant (DKK)', 'PAY_DKK')],[Markup.button.callback('Crypto', 'PAY_CRYPTO')],[Markup.button.callback('Revolut', 'PAY_REV')]]);
}

bot.action(/PAY_(.+)/, (ctx) => {
  ctx.session.order.payment = ctx.match[1];
  const total = ctx.session.cart.reduce((s, i) => s + i.price, 0);
  ctx.reply(payment.getPaymentText(total));
  ctx.session.step = 'confirm';
  ctx.reply('Bekraeft ordren:', Markup.inlineKeyboard([[Markup.button.callback('Bekraeft', 'FINAL_CONFIRM')],[Markup.button.callback('Annuller', 'CANCEL_ORDER')]]));
});

// FINAL CONFIRM
bot.action('FINAL_CONFIRM', async (ctx) => {
  const order = { id: Math.floor(Math.random()*90000)+10000, items: ctx.session.cart, total: ctx.session.cart.reduce((s,i)=>s+i.price,0), delivery: ctx.session.order.delivery, name: ctx.session.order.name, phone: ctx.session.order.phone, address: ctx.session.order.address || 'Afhentning', payment: ctx.session.order.payment, createdAt: new Date() };
  await ordersCollection.insertOne(order);
  const msg = ['Ny ordre','','ID: '+order.id,'Navn: '+order.name,'Telefon: '+order.phone,'Adresse: '+order.address,'Levering: '+order.delivery,'Betaling: '+order.payment,'','Produkter:',...order.items.map(i=>'- '+i.name+' ('+i.price+' kr)'),'','Total: '+order.total+' kr'].join(nl);
  bot.telegram.sendMessage(process.env.OWNER_CHAT_ID, msg);
  if (process.env.ADMIN_GROUP_ID) bot.telegram.sendMessage(process.env.ADMIN_GROUP_ID, msg);
  if (process.env.DRIVER_GROUP_ID) bot.telegram.sendMessage(process.env.DRIVER_GROUP_ID, msg);
  ctx.reply('Ordre bekraeftet! ID: ' + order.id + '. Vi kontakter dig snarest.');
  reset(ctx);
});

bot.action('CANCEL_ORDER', (ctx) => { reset(ctx); ctx.reply('Annulleret.'); });
bot.hears('Annuller', (ctx) => { reset(ctx); ctx.reply('Annulleret.'); });

bot.launch();
console.log('TopShelfFarm bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
