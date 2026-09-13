require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const { MongoClient } = require('mongodb');
const menu = require('./config/menu');

// EXPRESS KEEP-ALIVE SERVER (Render requires this)
const app = express();
app.get('/', (req, res) => res.send('TopShelfFarm Bot is running'));
app.listen(3000, () => console.log('Express server running on port 3000'));

// TELEGRAM BOT SETUP
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// MONGODB SETUP
const client = new MongoClient(process.env.MONGODB_URI);
let ordersCollection;

async function connectDB() {
  try {
    await client.connect();
    ordersCollection = client.db("runtzfarm").collection("orders");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
connectDB();

// START COMMAND
bot.start((ctx) => {
  ctx.reply(
    "Velkommen til TopShelfFarm 🌿\n\nTryk på *Menu* for at se vores udvalg.",
    Markup.keyboard([["📋 Menu"], ["🛒 Kurv", "❌ Annuller"]]).resize()
  );
});

// SHOW MENU CATEGORIES
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
        Markup.button.callback(`${item.name} — ${item.price} DKK`, `ITEM_${category}_${i}`)
      ])
    )
  );
});

// ITEM SELECT → ADD TO CART
bot.action(/ITEM_(.+)_(\d+)/, (ctx) => {
  const category = ctx.match[1];
  const index = Number(ctx.match[2]);
  const item = menu[category][index];

  if (!ctx.session.cart) ctx.session.cart = [];

  ctx.session.cart.push(item);

  ctx.reply(
    `Tilføjet til kurv:\n${item.name} — ${item.price} DKK`,
    Markup.keyboard([["📋 Menu"], ["🛒 Kurv", "❌ Annuller"]]).resize()
  );
});

// VIEW CART
bot.hears("🛒 Kurv", (ctx) => {
  if (!ctx.session.cart || ctx.session.cart.length === 0) {
    return ctx.reply("Din kurv er tom.");
  }

  let total = ctx.session.cart.reduce((sum, item) => sum + item.price, 0);
  let text = "🛒 *Din kurv:*\n\n";

  ctx.session.cart.forEach((item, i) => {
    text += `${i + 1}. ${item.name} — ${item.price} DKK\n`;
  });

  text += `\n*Total:* ${total} DKK`;

  ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✔ Bekræft ordre", "CONFIRM_ORDER")],
      [Markup.button.callback("❌ Ryd kurv", "CLEAR_CART")]
    ])
  );
});

// CLEAR CART
bot.action("CLEAR_CART", (ctx) => {
  ctx.session.cart = [];
  ctx.reply("Kurven er ryddet.");
});

// CONFIRM ORDER
bot.action("CONFIRM_ORDER", async (ctx) => {
  if (!ctx.session.cart || ctx.session.cart.length === 0) {
    return ctx.reply("Din kurv er tom.");
  }

  const order = {
    items: ctx.session.cart,
    total: ctx.session.cart.reduce((sum, item) => sum + item.price, 0),
    user: {
      id: ctx.from.id,
      username: ctx.from.username,
      name: ctx.from.first_name
    },
    createdAt: new Date(),
    orderId: Math.floor(Math.random() * 90000) + 10000
  };

  await ordersCollection.insertOne(order);

  ctx.reply(
    `✔ *Ordre modtaget!*\n\nOrdre ID: ${order.orderId}\nTotal: ${order.total} DKK\n\nVi kontakter dig snarest.`,
    { parse_mode: "Markdown" }
  );

  // Send order to owner
  bot.telegram.sendMessage(
    process.env.OWNER_CHAT_ID,
    `📦 *Ny ordre*\n\nID: ${order.orderId}\nTotal: ${order.total} DKK\nKunde: @${order.user.username || "ukendt"}\n\nProdukter:\n${order.items.map(i => `- ${i.name} (${i.price} DKK)`).join("\n")}`,
    { parse_mode: "Markdown" }
  );

  ctx.session.cart = [];
});

// CANCEL ORDER
bot.hears("❌ Annuller", (ctx) => {
  ctx.session.cart = [];
  ctx.reply("Ordre annulleret.");
});

// START BOT
bot.launch();
console.log("TopShelfFarm bot is running...");
