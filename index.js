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
bot.action("DELIVERY", (ctx) => {
  ctx.session.order.delivery = "delivery";
  ctx.session.step = "name";
  ctx.reply("Skriv dit *navn*:", { parse_mode: "Markdown" });
});

// PICKUP
bot.action("PICKUP", (ctx) => {
  ctx.session.order.delivery = "pickup";
  ctx.session.step = "name";
  ctx.reply("Skriv dit *navn*:", { parse_mode: "Markdown" });
});

// STEP 2+3 — NAME / PHONE / ADDRESS / PAYMENT
bot.on("text", async (ctx) => {
  if (ctx.session.step === "name") {
    ctx.session.order.name = ctx.message.text;
    ctx.session.step = "phone";
    return ctx.reply("Skriv dit *telefonnummer*:", { parse_mode: "Markdown" });
  }

  if (ctx.session.step === "phone") {
    ctx.session.order.phone = ctx.message.text;

    if (ctx.session.order.delivery === "delivery") {
      ctx.session.step = "address";
      return ctx.reply("Skriv *leveringsadresse*:", { parse_mode: "Markdown" });
    } else {
      ctx.session.step = "payment";
      return ctx.reply("Vælg betalingsmetode:", paymentButtons());
    }
  }

  if (ctx.session.step === "address") {
    ctx.session.order.address = ctx.message.text;
    ctx.session.step = "payment";
    return ctx.reply("Vælg betalingsmetode:", paymentButtons());
  }
});

// PAYMENT BUTTONS
function paymentButtons() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💵 DKK", "PAY_DKK")],
    [Markup.button.callback("💶 EUR", "PAY_EUR")],
    [Markup.button.callback("🪙 Crypto", "PAY_CRYPTO")],
    [Markup.button.callback("💳 Revolut", "PAY_REV")]
  ]);
}

// PAYMENT SELECT
bot.action(/PAY_(.+)/, async
