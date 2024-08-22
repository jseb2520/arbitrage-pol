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

// Setup provider for Polygon
const provider = new JsonRpcProvider('https://polygon-rpc.com/');
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

// Setup Telegram bot for alerts
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: false});
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

// Define a minimum profit threshold
const MINIMUM_PROFIT_THRESHOLD =
	parseInt(process.env.MINIMUM_PROFIT_THRESHOLD) || 0.01; // Example: $0.01

// Function to fetch top tokens on Polygon from CoinGecko
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

		return response.data.map((token) => ({
			id: token.id,
			symbol: token.symbol,
			address: token.contract_address,
		}));
	} catch (error) {
		console.error('Error fetching tokens from CoinGecko:', error.message);
		return [];
	}
};

// Function to get token balance
const getTokenBalance = async (tokenAddress) => {
	try {
		const token = new Token(ChainId.MATIC, tokenAddress, 18);
		const contract = new ethers.Contract(
			tokenAddress,
			['function balanceOf(address) view returns (uint256)'],
			provider
		);
		const balance = await contract.balanceOf(wallet.address);
		return ethers.formatUnits(balance, token.decimals);
	} catch (error) {
		console.error('Error fetching token balance:', error.message);
		return '0';
	}
};

// Function to check if sufficient balance of base token is available
const hasSufficientBalance = async (baseTokenAddress, requiredAmount) => {
	const balance = parseFloat(await getTokenBalance(baseTokenAddress));
	return balance >= requiredAmount;
};

// Function to estimate gas costs
const estimateGasCost = async (trade) => {
	const gasPrice = await provider.getGasPrice();
	const adjustedGasPrice = gasPrice.mul(110).div(100); // Adding a 10% buffer
	const gasEstimate = ethers.BigNumber.from(250000); // Adjusted gas limit
	return adjustedGasPrice.mul(gasEstimate);
};

// Function to calculate profit
const calculateProfit = (executionPrice, gasCost, amountIn) => {
	const amountOut = executionPrice.raw; // This should be the estimated amount out
	const profit = amountOut - gasCost.toString(); // Simplified example
	return profit;
};

// Function to execute the best trade
const executeTrade = async (trade, amountIn) => {
	try {
		const slippageTolerance = new ethers.Percent('50', '10000'); // 0.5% slippage
		const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
		const path = trade.route.path.map((token) => token.address);
		const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

		const swapTransaction = {
			to: trade.route.pairs[0].liquidityToken.address,
			data: trade.route.pairs[0].liquidityToken.interface.encodeFunctionData(
				'swapExactTokensForTokens',
				[
					ethers.parseUnits(
						amountIn.toString(),
						trade.inputAmount.token.decimals
					),
					amountOutMin,
					path,
					wallet.address,
					deadline,
				]
			),
			gasPrice: await provider.getGasPrice(),
			gasLimit: ethers.BigNumber.from(250000), // Adjust as needed
		};

		const txResponse = await wallet.sendTransaction(swapTransaction);
		console.log(`Executing trade with Transaction Hash: ${txResponse.hash}`);
		const receipt = await txResponse.wait();
		console.log('Trade confirmed:', receipt);

		// Notify via Telegram
		bot.sendMessage(
			telegramChatId,
			`Trade confirmed: ${txResponse.hash}\nPair: ${path.join(
				' -> '
			)}\nAmount Traded: ${amountIn}\nProfit: ${calculateProfit(
				trade.executionPrice,
				await estimateGasCost(trade),
				amountIn
			)}`
		);
	} catch (error) {
		console.error('Error executing trade:', error.message);
		bot.sendMessage(telegramChatId, `Error executing trade: ${error.message}`);
	}
};

// Function to fetch pairs
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

// Function to evaluate pairs across Uniswap and SushiSwap
const evaluatePairsAcrossDEXs = async () => {
	const tokenList = await fetchTopTokens();

	let bestTrade = null;
	let bestProfit = 0;

	try {
		for (let i = 0; i < tokenList.length; i++) {
			for (let j = i + 1; j < tokenList.length; j++) {
				const token1Address = tokenList[i].address;
				const token2Address = tokenList[j].address;

				if (!token1Address || !token2Address) {
					continue;
				}

				// Check if sufficient balance of base token is available
				if (
					!(await hasSufficientBalance(token1Address, 0.1)) &&
					!(await hasSufficientBalance(token2Address, 0.1))
				) {
					console.log(
						'Insufficient balance for tokens:',
						token1Address,
						token2Address
					);
					bot.sendMessage(
						telegramChatId,
						`Insufficient balance for tokens:,\n
							${token1Address},
							${token2Address}`
					);
					continue;
				}

				// Determine amount to trade (e.g., 10% of available balance)
				const token1Balance = parseFloat(await getTokenBalance(token1Address));
				const token2Balance = parseFloat(await getTokenBalance(token2Address));
				const amountToTrade = Math.min(token1Balance, token2Balance) * 0.1;

				// Fetch token data from Uniswap
				const uniswapPair = await fetchPairs(token1Address, token2Address);
				if (!uniswapPair) continue;

				// Uniswap Trade
				const uniswapRoute = new Route([uniswapPair], uniswapPair.token0);
				const uniswapTrade = new Trade(
					uniswapRoute,
					new TokenAmount(
						uniswapPair.token0,
						ethers.parseUnits(
							amountToTrade.toString(),
							uniswapPair.token0.decimals
						)
					),
					TradeType.EXACT_INPUT
				);

				// Fetch token data from SushiSwap
				const sushiPair = await SushiFetcher.fetchPairData(
					new SushiToken(SushiChainId.MATIC, token1Address, 18),
					new SushiToken(SushiChainId.MATIC, token2Address, 18),
					provider
				);

				if (!sushiPair) continue;

				// SushiSwap Trade
				const sushiRoute = new SushiRoute([sushiPair], sushiPair.token0);
				const sushiTrade = new SushiTrade(
					sushiRoute,
					new SushiTokenAmount(
						sushiPair.token0,
						ethers.parseUnits(
							amountToTrade.toString(),
							sushiPair.token0.decimals
						)
					),
					SushiTradeType.EXACT_INPUT
				);

				// Compare and choose the best trade among Uniswap and SushiSwap
				const bestCurrentTrade = [uniswapTrade, sushiTrade].reduce(
					(best, current) =>
						current.executionPrice.lessThan(best.executionPrice)
							? current
							: best
				);

				const gasCost = await estimateGasCost(bestCurrentTrade);
				const potentialProfit = calculateProfit(
					bestCurrentTrade.executionPrice,
					gasCost,
					amountToTrade
				);

				// Execute trade if there is any profit or if it meets the minimum threshold
				if (potentialProfit > 0) {
					bestProfit = potentialProfit;
					bestTrade = bestCurrentTrade;
				}
			}
		}

		if (bestTrade && bestProfit >= MINIMUM_PROFIT_THRESHOLD) {
			await executeTrade(bestTrade, amountToTrade);
		} else {
			console.log('No profitable trade found or profit below threshold.');
            bot.sendMessage(telegramChatId, 'No profitable trade found or profit below threshold.')
		}
	} catch (error) {
		console.error('Error evaluating pairs across DEXs:', error.message);
		bot.sendMessage(
			telegramChatId,
			`Error evaluating pairs across DEXs: ${error.message}`
		);
	}
};

// Function to evaluate triangular arbitrage opportunities
const evaluateTriangularArbitrage = async () => {
	const tokenList = await fetchTopTokens();

	try {
		for (let i = 0; i < tokenList.length; i++) {
			for (let j = i + 1; j < tokenList.length; j++) {
				for (let k = j + 1; k < tokenList.length; k++) {
					const token1Address = tokenList[i].address;
					const token2Address = tokenList[j].address;
					const token3Address = tokenList[k].address;

					if (!token1Address || !token2Address || !token3Address) {
						continue;
					}

					// Check if sufficient balance of base token is available
					if (
						!(await hasSufficientBalance(token1Address, 0.1)) &&
						!(await hasSufficientBalance(token2Address, 0.1)) &&
						!(await hasSufficientBalance(token3Address, 0.1))
					) {
						console.log(
							'Insufficient balance for tokens:',
							token1Address,
							token2Address,
							token3Address
						);
						bot.sendMessage(
							telegramChatId,
							`Insufficient balance for tokens:,\n
							${token1Address},
							${token2Address},
							${token3Address}`
						);
						continue;
					}

					// Determine amount to trade (e.g., 10% of available balance)
					const token1Balance = parseFloat(
						await getTokenBalance(token1Address)
					);
					const token2Balance = parseFloat(
						await getTokenBalance(token2Address)
					);
					const token3Balance = parseFloat(
						await getTokenBalance(token3Address)
					);
					const amountToTrade =
						Math.min(token1Balance, token2Balance, token3Balance) * 0.1;

					// Fetch pairs and perform trades
					const pair1 = await fetchPairs(token1Address, token2Address);
					const pair2 = await fetchPairs(token2Address, token3Address);
					const pair3 = await fetchPairs(token3Address, token1Address);

					if (!pair1 || !pair2 || !pair3) continue;

					const route1 = new Route([pair1], pair1.token0);
					const trade1 = new Trade(
						route1,
						new TokenAmount(
							pair1.token0,
							ethers.parseUnits(amountToTrade.toString(), pair1.token0.decimals)
						),
						TradeType.EXACT_INPUT
					);

					const route2 = new Route([pair2], pair2.token0);
					const trade2 = new Trade(
						route2,
						new TokenAmount(pair2.token0, trade1.outputAmount.toFixed()),
						TradeType.EXACT_INPUT
					);

					const route3 = new Route([pair3], pair3.token0);
					const trade3 = new Trade(
						route3,
						new TokenAmount(pair3.token0, trade2.outputAmount.toFixed()),
						TradeType.EXACT_INPUT
					);

					const profit = trade3.outputAmount.subtract(
						ethers.parseUnits(amountToTrade.toString(), pair1.token0.decimals)
					);
					if (profit.gt(0) || profit.gt(MINIMUM_PROFIT_THRESHOLD)) {
						console.log(
							`Triangular Arbitrage Opportunity: ${token1Address} -> ${token2Address} -> ${token3Address}`
						);
						console.log(
							`Profit: ${ethers.formatUnits(profit, pair1.token0.decimals)}`
						);
						// Notify via Telegram
						bot.sendMessage(
							telegramChatId,
							`Triangular Arbitrage Opportunity: ${token1Address} -> ${token2Address} -> ${token3Address}\nProfit: ${ethers.formatUnits(
								profit,
								pair1.token0.decimals
							)}`
						);
					}
				}
			}
		}
	} catch (error) {
		console.error('Error evaluating triangular arbitrage:', error.message);
		bot.sendMessage(
			telegramChatId,
			`Error evaluating triangular arbitrage: ${error.message}`
		);
	}
};

// Main function to continuously fetch trade quotes and evaluate strategies
const main = async () => {
	while (true) {
		await evaluatePairsAcrossDEXs();
		await evaluateTriangularArbitrage();
		await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 1 minute before the next iteration
	}
};

// Start the bot
main();
