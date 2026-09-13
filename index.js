require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const { MongoClient } = require('mongodb');
const menu = require('./config/menu');
const payment = require('./lib/paymentHandler');

// EXPRESS KEEP-ALIVE SERVER (Render)
const app = express();
app.get('/', (req, res) => res.send('TopShelfFarm Bot is running'));
app.listen(3000, () => console.log('Express server running on port 3000'));

// TELEGRAM BOT
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// MONGODB
const client = new MongoClient(process.env.MONGODB_URI);
let ordersCollection;

async function connectDB() {
  try {
    await client.connect();
    ordersCollection = client.db("runtzfarm").collection("orders");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB error:", err);
  }
}
connectDB();

// RESET SESSION
function reset(ctx) {
  ctx.session = {
    cart: [],
    step: null,
    order: {}
  };
}

// START
bot.start((ctx) => {
  reset(ctx);
  ctx.reply(
    "Velkommen til TopShelfFarm 🌿\n\nTryk på *Menu* for at se vores udvalg.",
    Markup.keyboard([["📋 Menu"], ["🛒 Kurv", "❌ Annuller"]]).resize()
  );
});

// MENU
bot.hears("📋 Menu", (ctx) => {
  const categories = Object.keys(menu);
  ctx.reply(
    "Vælg en kategori:",
    Markup.inlineKeyboard(
      categories.map((cat) => [Markup.button.callback(cat, `CAT_${cat}`)])
    )
  );
});

// CATEGORY SELECT
bot.action(/CAT_(.+)/, (ctx) => {
  const category = ctx.match[1];
  const items = menu[category];

  ctx.reply(
    `*${category}*\nVælg et produkt:`,
    Markup.inlineKeyboard(
      items.map((item, i) => [
        Markup.button.callback(
          `${item.name} — ${item.price} DKK (${item.unit})`,
          `ITEM_${category}_${i}`
        )
      ])
    ),
    { parse_mode: "Markdown" }
  );
});

// ITEM SELECT
bot.action(/ITEM_(.+)_(\d+)/, (ctx) => {
  const category = ctx.match[1];
  const index = Number(ctx.match[2]);
  const item = menu[category][index];

  ctx.session.cart.push(item);

  ctx.reply(
    `Tilføjet til kurv:\n${item.name} — ${item.price} DKK (${item.unit})`,
    Markup.keyboard([["📋 Menu"], ["🛒 Kurv", "❌ Annuller"]]).resize()
  );
});

// VIEW CART
bot.hears("🛒 Kurv", (ctx) => {
  if (!ctx.session.cart.length) {
    return ctx.reply("Din kurv er tom.");
  }

  let total = ctx.session.cart.reduce((sum, item) => sum + item.price, 0);
  let text = "🛒 *Din kurv:*\n\n";

  ctx.session.cart.forEach((item, i) => {
    text += `${i + 1}. ${item.name} — ${item.price} DKK (${item.unit})\n`;
  });

  text += `\n*Total:* ${total} DKK`;

  ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✔ Bekræft ordre", "STEP_DELIVERY")],
      [Markup.button.callback("❌ Ryd kurv", "CLEAR_CART")]
    ]),
    { parse_mode: "Markdown" }
  );
});

// CLEAR CART
bot.action("CLEAR_CART", (ctx) => {
  ctx.session.cart = [];
  ctx.reply("Kurven er ryddet.");
});

// STEP 1 — DELIVERY OR PICKUP
bot.action("STEP_DELIVERY", (ctx) => {
  ctx.session.step = "delivery";
  ctx.reply(
    "Hvordan vil du modtage ordren?",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚚 Levering", "DELIVERY")],
      [Markup.button.callback("📍 Afhentning", "PICKUP")]
    ])
  );
});

// DELIVERY
