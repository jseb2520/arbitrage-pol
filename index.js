/**
 * A bot that evaluates token pairs across Uniswap and SushiSwap DEXs on the Polygon network,
 * finds the most profitable trade, and executes it.
 */

const {JsonRpcProvider, Wallet, ethers} = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const {
	ChainId,
	Token,
	Fetcher,
	Route,
	Trade,
	TokenAmount,
	TradeType,
} = require('@uniswap/sdk');
const {
	ChainId: SushiChainId,
	Token: SushiToken,
	Fetcher: SushiFetcher,
	Route: SushiRoute,
	Trade: SushiTrade,
	TokenAmount: SushiTokenAmount,
	TradeType: SushiTradeType,
} = require('@sushiswap/sdk');

require('dotenv').config();

const provider = new JsonRpcProvider('https://polygon-rpc.com/');
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: false});
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

/**
 * Fetches the top 20 tokens by market capitalization on the Polygon network
 * from CoinGecko API.
 *
 * @returns {Promise<Array<{ id: string, symbol: string, address: string }>>}
 */
const fetchTopTokens = async () => {
	try {
		const response = await axios.get(
			'https://api.coingecko.com/api/v3/coins/markets',
			{
				params: {
					vs_currency: 'usd',
					order: 'market_cap_desc',
					per_page: 20,
					page: 1,
					sparkline: false,
					price_change_percentage: '24h',
					category: 'polygon-ecosystem',
				},
			}
		);

		return response.data
			.map((token) => ({
				id: token.id,
				symbol: token.symbol,
				address: token.platforms?.['polygon-pos'] || null, // Safe access with `?.`
			}))
			.filter((token) => token.address); // Filter out tokens with null addresses
	} catch (error) {
		console.error('Error fetching tokens from CoinGecko:', error.message);
		return [];
	}
};

/**
 * Estimates the gas cost for a trade.
 *
 * @param {Trade} trade - The trade to estimate gas cost for.
 * @returns {Promise<BigNumber>} - The estimated gas cost.
 */
const estimateGasCost = async (trade) => {
	const gasPrice = await provider.getGasPrice();
	const adjustedGasPrice = gasPrice.mul(110n).div(100n); // Adding a 10% buffer
	const gasEstimate = ethers.BigNumber.from(200_000n); // Set a reasonable estimate
	return adjustedGasPrice.mul(gasEstimate);
};

/**
 * Calculates the profit for a trade.
 *
 * @param {BigNumber} executionPrice - The execution price of the trade.
 * @param {BigNumber} gasCost - The estimated gas cost.
 * @returns {BigNumber} - The calculated profit.
 */
const calculateProfit = (executionPrice, gasCost) => {
	const profit = executionPrice.raw.sub(gasCost); // Adjusted for BigNumber subtraction
	return profit;
};

/**
 * Executes a trade on the Uniswap or SushiSwap DEX.
 *
 * @param {Trade} trade - The trade to execute.
 */
const executeTrade = async (trade) => {
	try {
		const slippageTolerance = new ethers.FixedNumber.from('0.5'); // 0.5% slippage
		const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
		const path = trade.route.path.map((token) => token.address);
		const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

		const swapTransaction = {
			to: trade.route.pairs[0].liquidityToken.address,
			data: trade.route.pairs[0].liquidityToken.interface.encodeFunctionData(
				'swapExactTokensForTokens',
				[
					ethers.parseUnits('1', trade.inputAmount.token.decimals), // Adjust input amount as needed
					amountOutMin,
					path,
					wallet.address,
					deadline,
				]
			),
			gasPrice: await provider.getGasPrice(),
			gasLimit: 200_000n,
		};

		const txResponse = await wallet.sendTransaction(swapTransaction);
		console.log(`Executing trade with Transaction Hash: ${txResponse.hash}`);
		const receipt = await txResponse.wait();
		console.log('Trade confirmed:', receipt);

		const tokenSymbols = path.map(
			(address) =>
				trade.route.tokens.find((token) => token.address === address).symbol
		);

		bot.sendMessage(
			telegramChatId,
			`Trade confirmed: ${txResponse.hash}\nTokens: ${tokenSymbols.join(
				' -> '
			)}\nAmount: ${trade.inputAmount.toExact()}\nProfit: ${calculateProfit(
				trade.executionPrice,
				await estimateGasCost(trade)
			)}`
		);
	} catch (error) {
		console.error('Error executing trade:', error.message);
		bot.sendMessage(telegramChatId, `Error executing trade: ${error.message}`);
	}
};

/**
 * Fetches a token pair from Uniswap and SushiSwap DEXs.
 *
 * @param {string} token1Address - The address of the first token.
 * @param {string} token2Address - The address of the second token.
 * @returns {Promise<Route | null>} - The fetched pair data or null if an error occurs.
 */
const fetchPairs = async (token1Address, token2Address) => {
	try {
		const token1 = new Token(ChainId.MATIC, token1Address, 18);
		const token2 = new Token(ChainId.MATIC, token2Address, 18);

		const pair = await Fetcher.fetchPairData(token1, token2, provider);
		return pair;
	} catch (error) {
		console.error('Error fetching pair data:', error.message);
		return null;
	}
};

const stochasticDecision = (trade, profit, threshold) => {
	const probability = Math.random(); // Generates a number between 0 and 1
	const profitProbability = profit.div(threshold).toNumber(); // Normalized profit
	return profitProbability > probability;
};

/**
 * Evaluates token pairs across Uniswap and SushiSwap DEXs, finds the most profitable trade, and executes it.
 */
const evaluatePairsAcrossDEXs = async () => {
	const tokenList = await fetchTopTokens();

	let bestTrade = null;
	let bestProfit = 0n;

	try {
		const minimumProfitThreshold = ethers.parseUnits(
			process.env.MINIMUM_PROFIT_THRESHOLD || '0.001'
		);
		for (let i = 0; i < tokenList.length; i++) {
			for (let j = i + 1; j < tokenList.length; j++) {
				const token1Address = tokenList[i].address;
				const token2Address = tokenList[j].address;

				if (!token1Address || !token2Address) {
					console.error(
						`Invalid token address: ${token1Address} ${token2Address}`
					);
					continue;
				}

				const uniswapPair = await fetchPairs(token1Address, token2Address);
				if (!uniswapPair) continue;

				const uniswapRoute = new Route([uniswapPair], uniswapPair.token0);
				const uniswapTrade = new Trade(
					uniswapRoute,
					new TokenAmount(
						uniswapPair.token0,
						ethers.parseUnits('1', uniswapPair.token0.decimals)
					),
					TradeType.EXACT_INPUT
				);

				const sushiPair = await SushiFetcher.fetchPairData(
					new SushiToken(SushiChainId.MATIC, token1Address, 18),
					new SushiToken(SushiChainId.MATIC, token2Address, 18),
					provider
				);

				if (!sushiPair) continue;

				const sushiRoute = new SushiRoute([sushiPair], sushiPair.token0);
				const sushiTrade = new SushiTrade(
					sushiRoute,
					new SushiTokenAmount(
						sushiPair.token0,
						ethers.parseUnits('1', sushiPair.token0.decimals)
					),
					SushiTradeType.EXACT_INPUT
				);

				const bestCurrentTrade = [uniswapTrade, sushiTrade].reduce(
					(best, current) =>
						current.executionPrice.lessThan(best.executionPrice)
							? current
							: best
				);

				const gasCost = await estimateGasCost(bestCurrentTrade);
				const potentialProfit = calculateProfit(
					bestCurrentTrade.executionPrice,
					gasCost
				);

				if (potentialProfit.gt(minimumProfitThreshold)) {
					bestProfit = potentialProfit;
					bestTrade = bestCurrentTrade;
				}
			}
		}

		const profitThreshold = ethers.parseUnits('0.001', 'ether'); // Example threshold

		if (
			bestTrade &&
			(bestProfit.gt(0n) ||
				stochasticDecision(bestTrade, bestProfit, profitThreshold))
		) {
			await executeTrade(bestTrade);
		} else {
			console.log('No profitable trade found or stochastic decision was no');
		}
	} catch (error) {
		console.error('Error evaluating pairs across DEXs:', error.message);
		bot.sendMessage(telegramChatId, `Error evaluating pairs: ${error.message}`);
	}
};

/**
 * Runs the bot in an infinite loop, evaluating pairs and executing trades every 30 seconds.
 */
const runBot = async () => {
	while (true) {
		await evaluatePairsAcrossDEXs();
		await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds before next evaluation
	}
};

runBot();
