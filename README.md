# Runtz Farm Order Bot - Setup Guide

This bot lets customers browse your menu, build a cart, choose pickup
or delivery, and send you the order, right inside Telegram. Cash on
pickup/delivery, same as set up.

## Step 1 - Create the bot with BotFather

1. In Telegram, search for @BotFather and open a chat with it.
2. Send /newbot
3. Give it a name and a username ending in bot.
4. BotFather will give you a token, a long string. Save it, you will
need it in Step 3.

## Step 2 - Get your own chat ID

1. Search for @userinfobot in Telegram and open a chat.
2. Send any message. It replies with your Id, a number. That is
your OWNER_CHAT_ID.
3. Important: send /start to your new bot at least once from your
own account, so it is allowed to message you first.

## Step 3 - Deploy to Render

1. On Render: New + then Web Service, connect this repo.
2. Build command: npm install
Start command: npm start
3. Under Environment, add two variables:
BOT_TOKEN = the token from Step 1
OWNER_CHAT_ID = the id from Step 2
4. Deploy. Once live, message your bot with /start.

## Editing the menu

Everything customers see lives in config/menu.js. Open that file,
change the names, prices, units, save, and push to GitHub, Render
will redeploy automatically.

## How orders reach you

When a customer confirms an order, the bot sends you a message with
their cart, name, phone, delivery/pickup choice, and address if
  applicable, plus their Telegram contact so you can follow up. The
bot does not auto-accept anything.

## Notes

- No payment processing, cash on pickup/delivery only.
- Cart data is kept in memory, so a restart clears in-progress carts
(already-sent orders are unaffected).
