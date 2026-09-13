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

// ─── BOT SETUP ────────────────────────────────────────────────────────────────
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

  await ctx.reply(
    '👋 Velkommen til TopShelfFarm!\n\n' +
    'For at beskytte vores kunder kræver vi en godkendelse, inden du kan bestille.\n\n' +
    '📨 Din adgangsanmodning er nu sendt til ejeren.\n\n' +
    'Du vil modtage en besked her på Telegram, når du er godkendt — det sker typisk hurtigt.\n\n' +
    'Har du spørgsmål i mellemtiden, er du velkommen til at kontakte os direkte.\n\n' +
    'Vi glæder os til at betjene dig! 🌿'
  );
}
