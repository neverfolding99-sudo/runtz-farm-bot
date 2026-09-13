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
async
