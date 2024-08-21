# Crypto Arbitrage Trading Bot

## Overview

This bot continuously evaluates cryptocurrency trading pairs across Uniswap and SushiSwap on the Polygon network to identify profitable arbitrage opportunities. When a profitable trade is found, it automatically executes the trade and sends detailed notifications via Telegram.

## Features

- **Fetches top tokens** from CoinGecko for the Polygon ecosystem.
- **Evaluates trading pairs** across Uniswap and SushiSwap.
- **Calculates potential profits** and checks if trades are profitable.
- **Executes trades** automatically.
- **Sends Telegram notifications** with trade details and token balances.

## Prerequisites

- **Node.js**: Ensure you have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).
- **Telegram Bot Token**: Create a bot using [BotFather](https://core.telegram.org/bots#botfather) and get your bot token.
- **Private Key**: Your Ethereum private key to sign transactions.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/crypto-arbitrage-bot.git
   cd crypto-arbitrage-bot

   ```

2. **Install dependencies:**

```bash
npm install
```

3. **Create a .env file in the root directory with the following content:**

```bash
PRIVATE_KEY=your_private_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

Replace `your_private_key`, `your_telegram_bot_token`, and `your_telegram_chat_id`

## Usage

1. **Run the bot:**

```bash
node index.js
```

The bot will start fetching trade quotes and evaluating trading pairs. It will execute profitable trades and notify you via Telegram.

2. **Stop the bot:**

If you need to stop the bot, you can simply interrupt the process in your terminal (e.g., by pressing `Ctrl+C`).

## Configuration

- **Fetching Tokens:** The bot fetches the top tokens from CoinGecko. You can modify the token fetching logic in the `fetchTopTokens` function.
- **Trading Pairs:** The bot evaluates trading pairs from Uniswap and SushiSwap. You can adjust the trading logic in the `evaluatePairsAcrossDEXs` function.
- **Trade Execution:** The bot automatically executes trades with a 0.5% slippage tolerance. You can adjust the slippage and other trade parameters in the `executeTrade` function.
- **Notify Details:** The bot sends detailed trade information and token balances via Telegram. You can customize the message format in the `notifyTelegram` function.

## Troubleshooting

1. **Errors in Token Fetching:** Ensure that the CoinGecko API is available and that the token addresses are correct.
2. **Transaction Failures:** Verify that your Ethereum private key has sufficient funds for gas fees.
3. **Telegram Notifications:** Ensure your Telegram bot is correctly configured and has permissions to send messages.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
