require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const menu = require('./config/menu');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID || null;
const REVOLUT_LINK = process.env.REVOLUT_LINK || null;
const DRIVER_CHAT_IDS = (process.env.DRIVER_CHAT_IDS || '')
.split(',')
.map((s) => s.trim())
.filter(Boolean);

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

bot.command('groupid', (ctx) => {
  ctx.reply('Chat id: ' + ctx.chat.id);
});

const orderStore = {};

function formatCart(cart) {
  if (cart.length === 0) return 'Din kurv er tom.';
  let total = 0;
  const lines = cart.map((item, i) => {
    total += item.price;
    return (i + 1) + '. ' + item.name + ' (' + item.unit + ') - $' + item.price;
  });
  lines.push('');
  lines.push('Total: $' + total);
  return lines.join('\n');
}

function categoryText(category) {
  const items = menu[category];
  const lines = items.map((item, i) => (i + 1) + '. ' + item.name + ' - $' + item.price + '/' + item.unit + '\n' + item.description);
  return category + ':\n\n' + lines.join('\n\n');
}

function categoryKeyboard() {
  const buttons = Object.keys(menu).map((cat) => [
    Markup.button.callback(cat, 'cat:' + cat),
    ]);
  buttons.push([Markup.button.callback('Se kurv', 'view_cart')]);
  return Markup.inlineKeyboard(buttons);
}

function itemsKeyboard(category) {
  const items = menu[category];
  const buttons = items.map((item, i) => [
    Markup.button.callback(item.name + ' - $' + item.price + '/' + item.unit, 'add:' + category + ':' + i),
    ]);
  buttons.push([Markup.button.callback('Tilbage til kategorier', 'back_to_categories')]);
  return Markup.inlineKeyboard(buttons);
}

function cartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Tilfoj flere varer', 'back_to_categories')],
    [Markup.button.callback('Til kassen', 'checkout')],
    [Markup.button.callback('Ryd kurv', 'clear_cart')],
    ]);
}

bot.start((ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply('Velkommen til Runtz Farm! Se menuen nedenfor og tryk pa varer for at tilfoje dem til din kurv. Nar du er klar, tryk Til kassen.', categoryKeyboard());
});

bot.command('menu', (ctx) => {
  ctx.reply('Menu:', categoryKeyboard());
});

bot.command('cart', (ctx) => {
  ctx.reply(formatCart(ctx.session.cart), cartKeyboard());
});

bot.command('cancel', (ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.reply('Ordre annulleret. Send /start for at begynde igen.');
});

bot.action(/^cat:(.+)$/, (ctx) => {
  const category = ctx.match[1];
  ctx.editMessageText(categoryText(category), itemsKeyboard(category));
});

bot.action('back_to_categories', (ctx) => {
  ctx.editMessageText('Menu:', categoryKeyboard());
});

bot.action(/^add:(.+):(\d+)$/, (ctx) => {
  const category = ctx.match[1];
  const idx = parseInt(ctx.match[2], 10);
  const item = menu[category][idx];
  ctx.session.cart.push(item);
  ctx.answerCbQuery(item.name + ' tilfojet til kurv');
});

bot.action('view_cart', (ctx) => {
  ctx.editMessageText(formatCart(ctx.session.cart), cartKeyboard());
});

bot.action('clear_cart', (ctx) => {
  ctx.session.cart = [];
  ctx.editMessageText('Kurv ryddet.', categoryKeyboard());
});

bot.action('checkout', (ctx) => {
  if (ctx.session.cart.length === 0) {
    return ctx.answerCbQuery('Din kurv er tom, tilfoj noget forst!');
  }
  ctx.session.stage = 'awaiting_fulfillment';
  ctx.editMessageText('Hvordan vil du gerne have din ordre?', Markup.inlineKeyboard([
    [Markup.button.callback('Levering', 'fulfillment:delivery')],
    [Markup.button.callback('Afhentning', 'fulfillment:pickup')],
    ]));
});

bot.action(/^fulfillment:(delivery|pickup)$/, (ctx) => {
  ctx.session.order.fulfillment = ctx.match[1];
  ctx.session.stage = 'awaiting_name';
  ctx.editMessageText('Hvilket navn skal vi saette pa ordren?');
});

function suggestedUsername(ctx) {
  return ctx.from && ctx.from.username ? ctx.from.username : null;
}

function askTiming(ctx) {
  ctx.session.stage = 'awaiting_timing';
  return ctx.reply('Hvornar vil du gerne have din ordre? ✨', Markup.inlineKeyboard([
    [Markup.button.callback('I dag', 'timing:today')],
    [Markup.button.callback('I morgen', 'timing:tomorrow')],
    ]));
}

bot.action(/^timing:(today|tomorrow)$/, (ctx) => {
  ctx.session.order.day = ctx.match[1];
  ctx.session.stage = 'awaiting_time';
  const dayDa = ctx.match[1] === 'today' ? 'i dag' : 'i morgen';
  return ctx.editMessageText('Perfekt, ' + dayDa + '. Hvilket klokkeslaet passer dig? (f.eks. 16:00)');
});

function askPayment(ctx) {
  if (!REVOLUT_LINK) {
    ctx.session.order.payment = 'cash';
    ctx.session.stage = 'confirming';
    return sendConfirmation(ctx);
  }
  ctx.session.stage = 'awaiting_payment';
  const fulfillmentDa = ctx.session.order.fulfillment === 'delivery' ? 'levering' : 'afhentning';
  return ctx.reply('Hvordan vil du gerne betale?', Markup.inlineKeyboard([
    [Markup.button.callback('Kontant ved ' + fulfillmentDa, 'payment:cash')],
    [Markup.button.callback('Revolut Pay', 'payment:revolut')],
    ]));
}

bot.action(/^payment:(cash|revolut)$/, (ctx) => {
  ctx.session.order.payment = ctx.match[1];
  ctx.session.stage = 'confirming';
  return sendConfirmation(ctx);
});

bot.on('text', async (ctx) => {
  const stage = ctx.session.stage;

       if (stage === 'awaiting_name') {
         ctx.session.order.name = ctx.message.text;
         ctx.session.stage = 'awaiting_phone';
         return ctx.reply('Hvilket telefonnummer kan vi kontakte dig pa?');
       }

       if (stage === 'awaiting_phone') {
         ctx.session.order.phone = ctx.message.text;
         ctx.session.stage = 'awaiting_telegram';
         const suggestion = suggestedUsername(ctx);
         const hint = suggestion ? (' Vi har dig som @' + suggestion + ', svar det eller skriv et andet.') : ' Skriv det uden @ tegnet.';
         return ctx.reply('Hvad er dit Telegram brugernavn, sa vi kan skrive til dig der?' + hint);
       }

       if (stage === 'awaiting_telegram') {
         let handle = ctx.message.text.trim();
         if (handle.startsWith('@')) {
           handle = handle.slice(1);
         }
         ctx.session.order.telegramUsername = handle;
         if (ctx.session.order.fulfillment === 'delivery') {
           ctx.session.stage = 'awaiting_address';
           return ctx.reply('Hvilken adresse skal vi levere til?');
         } else {
           return askTiming(ctx);
         }
       }

       if (stage === 'awaiting_address') {
         ctx.session.order.address = ctx.message.text;
         return askTiming(ctx);
       }

       if (stage === 'awaiting_time') {
         ctx.session.order.time = ctx.message.text;
         return askPayment(ctx);
       }
});

function paymentLabel(o) {
  if (o.payment === 'revolut') return 'Revolut Pay';
  const fulfillmentDa = o.fulfillment === 'delivery' ? 'levering' : 'afhentning';
  return 'Kontant ved ' + fulfillmentDa;
}

function fulfillmentLabel(o) {
  return o.fulfillment === 'delivery' ? 'Levering' : 'Afhentning';
}

function dayLabel(o) {
  return o.day === 'today' ? 'I dag' : 'I morgen';
}

function sendConfirmation(ctx) {
  const o = ctx.session.order;
  const summary = [
    'Bekraeft venligst din ordre:',
    '',
    formatCart(ctx.session.cart),
    '',
    'Navn: ' + o.name,
    'Telefon: ' + o.phone,
    'Telegram: @' + o.telegramUsername,
    'Metode: ' + fulfillmentLabel(o),
    o.address ? ('Adresse: ' + o.address) : null,
    '📅 Onsket tidspunkt: ' + dayLabel(o) + ' kl. ' + o.time,
    '',
    'Betaling: ' + paymentLabel(o),
    ].filter(Boolean).join('\n');

return ctx.reply(summary, Markup.inlineKeyboard([
  [Markup.button.callback('Bekraeft ordre', 'confirm_order')],
  [Markup.button.callback('Annuller', 'cancel_order')],
  ]));
}

bot.action('cancel_order', (ctx) => {
  ctx.session = { cart: [], stage: null, order: {} };
  ctx.editMessageText('Ordre annulleret. Send /start for at begynde igen.');
});

async function broadcastOrder(ctx, orderId, text, keyboard) {
  const targets = [OWNER_CHAT_ID];
  if (GROUP_CHAT_ID) targets.push(GROUP_CHAT_ID);
  if (ctx.session.order.fulfillment === 'delivery') {
    for (const id of DRIVER_CHAT_IDS) targets.push(id);
  }
  const refs = [];
  for (const chatId of targets) {
    try {
      const sent = await ctx.telegram.sendMessage(chatId, text, keyboard);
      refs.push({ chatId: sent.chat.id, messageId: sent.message_id });
    } catch (err) {
      console.error('Failed to notify ' + chatId + ':', err.message);
    }
  }
  orderStore[orderId] = { text: text, refs: refs, claimedBy: null, completed: false };
}

bot.action('confirm_order', async (ctx) => {
  const o = ctx.session.order;
  const cart = ctx.session.cart;
  const customer = ctx.from;
  const orderId = 'o' + Date.now();

           const header = o.fulfillment === 'delivery' ? '🚗 NY LEVERING' : '🏬 NY AFHENTNING';
  const orderMessage = [
    header,
    '',
    formatCart(cart),
    '',
    'Navn: ' + o.name,
    'Telefon: ' + o.phone,
    'Telegram: @' + o.telegramUsername,
    'Metode: ' + fulfillmentLabel(o),
    o.address ? ('Adresse: ' + o.address) : null,
    '📅 Onsket tidspunkt: ' + dayLabel(o) + ' kl. ' + o.time,
    'Betaling: ' + paymentLabel(o),
    '',
    'Telegram konto id: ' + customer.id,
    ].filter(Boolean).join('\n');

           const claimKeyboard = Markup.inlineKeyboard([
             [Markup.button.callback('🚗 Tag ordre', 'claim:' + orderId)],
             ]);

           await broadcastOrder(ctx, orderId, orderMessage, claimKeyboard);

           const fulfillmentDa = o.fulfillment === 'delivery' ? 'levering' : 'afhentning';
  let confirmText = 'Ordre modtaget! Vi kontakter dig for at bekraefte detaljer om ' + fulfillmentDa + ' ' + dayLabel(o).toLowerCase() + ' kl. ' + o.time + '. Tak fordi du valgte Runtz Farm!';
  if (o.payment === 'revolut' && REVOLUT_LINK) {
    confirmText += '\n\nBetal her: ' + REVOLUT_LINK;
  }

           await ctx.editMessageText(confirmText);
  ctx.session = { cart: [], stage: null, order: {} };
});

bot.action(/^claim:(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = orderStore[orderId];
  if (!order) {
    return ctx.answerCbQuery('Ordren blev ikke fundet (botten er muligvis genstartet).');
  }
  if (order.claimedBy) {
    return ctx.answerCbQuery('Allerede taget af ' + order.claimedBy);
  }
  const staffer = ctx.from.first_name || ctx.from.username || 'Ukendt';
  order.claimedBy = staffer;
  const newText = order.text + '\n\n🚗 Taget af: ' + staffer;
  const newKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Leveret / Afhentet', 'complete:' + orderId)],
    ]);
  for (const ref of order.refs) {
    try {
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, newText, newKeyboard);
    } catch (err) {
      console.error('Failed to update ref:', err.message);
    }
  }
  ctx.answerCbQuery('Du har taget ordren!');
});

bot.action(/^complete:(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = orderStore[orderId];
  if (!order) {
    return ctx.answerCbQuery('Ordren blev ikke fundet (botten er muligvis genstartet).');
  }
  if (order.completed) {
    return ctx.answerCbQuery('Allerede markeret som fuldfort.');
  }
  const staffer = ctx.from.first_name || ctx.from.username || 'Ukendt';
  order.completed = true;
  const base = order.claimedBy ? (order.text + '\n\n🚗 Taget af: ' + order.claimedBy) : order.text;
  const newText = base + '\n\n✅ Fuldfort af: ' + staffer;
  for (const ref of order.refs) {
    try {
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, newText);
    } catch (err) {
      console.error('Failed to update ref:', err.message);
    }
  }
  ctx.answerCbQuery('Ordre markeret som fuldfort!');
  delete orderStore[orderId];
});

bot.launch();
console.log('Runtz Farm bot is running...');

const app = express();
app.get('/', (req, res) => res.send('Runtz Farm bot is alive.'));
app.listen(process.env.PORT || 3000, () => {
  console.log('Healthcheck server listening.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const https = require('https');
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://runtz-farm-bot.onrender.com';
setInterval(() => {
  https.get(SELF_URL, (res) => {
    res.resume();
  }).on('error', () => {});
}, 10 * 60 * 1000);
