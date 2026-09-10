# Runtz Farm Order Bot - Setup Guide

This bot lets customers browse your menu, build a cart, choose pickup
or delivery, select a payment method, and send you the order, right inside Telegram.

## Features

✅ **Menu Management** - Easy to edit products and prices  
✅ **Multiple Payment Methods** - Cash, Stripe, Venmo, PayPal  
✅ **Flexible Fulfillment** - Delivery or Pickup  
✅ **Order Tracking** - Unique order IDs for easy reference  
✅ **Auto-notifications** - Receive orders directly on Telegram  

## Step 1 - Create the bot with BotFather

1. In Telegram, search for @BotFather and open a chat with it.
2. Send `/newbot`
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
2. Build command: `npm install`
   Start command: `npm start`
3. Under Environment, add the required variables:
   - `BOT_TOKEN` = the token from Step 1
   - `OWNER_CHAT_ID` = the id from Step 2

4. (Optional) Add payment service credentials:
   - `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` for Stripe
   - `VENMO_USERNAME` and `VENMO_ENABLED=true` for Venmo
   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` for PayPal

5. Deploy. Once live, message your bot with `/start`.

## Step 4 - Customize

### Editing the Menu

Everything customers see lives in `config/menu.js`. 

```javascript
module.exports = {
  "Category 📝": [
    { name: "Product Name 🌿", price: 45, unit: "1/8 oz" },
    { name: "Another Product 🌿", price: 50, unit: "1/4 oz" },
  ],
};
```

Simply edit the names, prices, and units, save, and push to GitHub. Render will auto-redeploy.

### Configuring Payments

Edit `config/payments.js` to enable/disable payment methods and set fees.

## How Orders Reach You

When a customer confirms an order, the bot sends you a message with:
- Their cart and total
- Name, phone, Telegram handle
- Delivery/pickup choice and address
- Payment method and amount
- Order ID for tracking

You can then manually confirm and coordinate delivery/pickup timing.

## Payment Methods

**💵 Cash** - Collect payment on pickup/delivery (no fees)  
**💳 Stripe** - Card payments online (2.9% + $0.30 fee)  
**📱 Venmo** - Request payment via Venmo  
**🅿️ PayPal** - Online payment processing  

## Commands

- `/start` - Start the bot and view menu
- `/menu` - View menu categories
- `/cart` - View current cart
- `/cancel` - Cancel current order

## Notes

- Cart data is kept in memory, so a server restart clears in-progress carts
  (already-sent orders are unaffected).
- Payment links are generated dynamically based on customer selections.
- All orders include unique IDs for easy tracking.

## Troubleshooting

**Bot not responding?**
- Verify BOT_TOKEN and OWNER_CHAT_ID are correct in environment variables
- Ensure you've sent /start to the bot at least once

**Orders not reaching you?**
- Confirm OWNER_CHAT_ID is your personal Telegram ID (not the bot's)
- Check Telegram privacy settings allow bot messages

**Payment methods not showing?**
- For Stripe: add STRIPE_SECRET_KEY to environment
- For Venmo: set VENMO_USERNAME and VENMO_ENABLED=true
- For PayPal: add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET

## Support

For issues or feature requests, open an issue on GitHub or contact support.
