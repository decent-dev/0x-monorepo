import {
    artifacts as assetProxyArtifacts,
    ERC1155ProxyContract,
    ERC1155ProxyWrapper,
    ERC20ProxyContract,
    ERC20Wrapper,
    ERC721ProxyContract,
    ERC721Wrapper,
    MultiAssetProxyContract,
} from '@0x/contracts-asset-proxy';
import { ERC1155Contract as ERC1155TokenContract, Erc1155Wrapper as ERC1155Wrapper } from '@0x/contracts-erc1155';
import { DummyERC20TokenContract } from '@0x/contracts-erc20';
import { DummyERC721TokenContract } from '@0x/contracts-erc721';
import {
    chaiSetup,
    constants,
    OrderFactory,
    provider,
    txDefaults,
    web3Wrapper,
} from '@0x/contracts-test-utils';
import { BlockchainLifecycle } from '@0x/dev-utils';
import { assetDataUtils, ExchangeRevertErrors, orderHashUtils } from '@0x/order-utils';
import { OrderStatus, RevertReason } from '@0x/types';
import { BigNumber, providerUtils } from '@0x/utils';
import { Web3Wrapper } from '@0x/web3-wrapper';
import * as chai from 'chai';
import * as _ from 'lodash';

import {
    artifacts,
    constants as exchangeConstants,
    ExchangeContract,
    ExchangeWrapper,
    ReentrantERC20TokenContract,
    TestExchangeInternalsContract,
} from '../src';

import { MatchOrderTester, TokenBalances } from './utils/match_order_tester';

const ONE = new BigNumber(1);
const TWO = new BigNumber(2);

const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);
chaiSetup.configure();
const expect = chai.expect;

describe('matchOrders', () => {
    let chainId: number;
    let makerAddressLeft: string;
    let makerAddressRight: string;
    let owner: string;
    let takerAddress: string;
    let feeRecipientAddressLeft: string;
    let feeRecipientAddressRight: string;

    let erc20Tokens: DummyERC20TokenContract[];
    let erc721Token: DummyERC721TokenContract;
    let erc1155Token: ERC1155TokenContract;
    let reentrantErc20Token: ReentrantERC20TokenContract;
    let exchange: ExchangeContract;
    let erc20Proxy: ERC20ProxyContract;
    let erc721Proxy: ERC721ProxyContract;
    let erc1155Proxy: ERC1155ProxyContract;
    let erc1155ProxyWrapper: ERC1155ProxyWrapper;

    let exchangeWrapper: ExchangeWrapper;
    let erc20Wrapper: ERC20Wrapper;
    let erc721Wrapper: ERC721Wrapper;
    let erc1155Wrapper: ERC1155Wrapper;
    let orderFactoryLeft: OrderFactory;
    let orderFactoryRight: OrderFactory;

    let tokenBalances: TokenBalances;

    let defaultERC20MakerAssetAddress: string;
    let defaultERC20TakerAssetAddress: string;
    let defaultERC721AssetAddress: string;
    let defaultERC1155AssetAddress: string;
    let defaultFeeTokenAddress: string;

    let matchOrderTester: MatchOrderTester;

    let testExchange: TestExchangeInternalsContract;

    before(async () => {
        await blockchainLifecycle.startAsync();
    });
    after(async () => {
        await blockchainLifecycle.revertAsync();
    });
    before(async () => {
        // Get the chain ID.
        chainId = await providerUtils.getChainIdAsync(provider);
        // Create accounts
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        const usedAddresses = ([
            owner,
            makerAddressLeft,
            makerAddressRight,
            takerAddress,
            feeRecipientAddressLeft,
            feeRecipientAddressRight,
        ] = accounts);
        const addressesWithBalances = usedAddresses.slice(1);
        // Create wrappers
        erc20Wrapper = new ERC20Wrapper(provider, addressesWithBalances, owner);
        erc721Wrapper = new ERC721Wrapper(provider, addressesWithBalances, owner);
        erc1155ProxyWrapper = new ERC1155ProxyWrapper(provider, addressesWithBalances, owner);
        // Deploy ERC20 token & ERC20 proxy
        const numDummyErc20ToDeploy = 4;
        erc20Tokens = await erc20Wrapper.deployDummyTokensAsync(numDummyErc20ToDeploy, constants.DUMMY_TOKEN_DECIMALS);
        erc20Proxy = await erc20Wrapper.deployProxyAsync();
        await erc20Wrapper.setBalancesAndAllowancesAsync();
        // Deploy ERC721 token and proxy
        [erc721Token] = await erc721Wrapper.deployDummyTokensAsync();
        erc721Proxy = await erc721Wrapper.deployProxyAsync();
        await erc721Wrapper.setBalancesAndAllowancesAsync();
        // Deploy ERC1155 token and proxy
        [erc1155Wrapper] = await erc1155ProxyWrapper.deployDummyContractsAsync();
        erc1155Token = erc1155Wrapper.getContract();
        erc1155Proxy = await erc1155ProxyWrapper.deployProxyAsync();
        await erc1155ProxyWrapper.setBalancesAndAllowancesAsync();
        // Deploy MultiAssetProxy.
        const multiAssetProxyContract = await MultiAssetProxyContract.deployFrom0xArtifactAsync(
            assetProxyArtifacts.MultiAssetProxy,
            provider,
            txDefaults,
        );
        // Depoy exchange
        exchange = await ExchangeContract.deployFrom0xArtifactAsync(
            artifacts.Exchange,
            provider,
            txDefaults,
            new BigNumber(chainId),
        );
        exchangeWrapper = new ExchangeWrapper(exchange, provider);
        await exchangeWrapper.registerAssetProxyAsync(erc20Proxy.address, owner);
        await exchangeWrapper.registerAssetProxyAsync(erc721Proxy.address, owner);
        await exchangeWrapper.registerAssetProxyAsync(erc1155Proxy.address, owner);
        await exchangeWrapper.registerAssetProxyAsync(multiAssetProxyContract.address, owner);
        // Authorize proxies.
        await erc20Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            exchange.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await erc721Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            exchange.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await erc1155Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            exchange.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await multiAssetProxyContract.addAuthorizedAddress.awaitTransactionSuccessAsync(
            exchange.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await erc20Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            multiAssetProxyContract.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await erc721Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            multiAssetProxyContract.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await erc1155Proxy.addAuthorizedAddress.awaitTransactionSuccessAsync(
            multiAssetProxyContract.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await multiAssetProxyContract.registerAssetProxy.awaitTransactionSuccessAsync(
            erc20Proxy.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await multiAssetProxyContract.registerAssetProxy.awaitTransactionSuccessAsync(
            erc721Proxy.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await multiAssetProxyContract.registerAssetProxy.awaitTransactionSuccessAsync(
            erc1155Proxy.address,
            { from: owner },
            constants.AWAIT_TRANSACTION_MINED_MS,
        );

        reentrantErc20Token = await ReentrantERC20TokenContract.deployFrom0xArtifactAsync(
            artifacts.ReentrantERC20Token,
            provider,
            txDefaults,
            exchange.address,
        );

        // Set default addresses
        defaultERC20MakerAssetAddress = erc20Tokens[0].address;
        defaultERC20TakerAssetAddress = erc20Tokens[1].address;
        defaultFeeTokenAddress = erc20Tokens[2].address;
        defaultERC721AssetAddress = erc721Token.address;
        defaultERC1155AssetAddress = erc1155Token.address;
        const domain = {
            verifyingContractAddress: exchange.address,
            chainId,
        };
        // Create default order parameters
        const defaultOrderParamsLeft = {
            ...constants.STATIC_ORDER_PARAMS,
            makerAddress: makerAddressLeft,
            makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
            takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
            makerFeeAssetData: assetDataUtils.encodeERC20AssetData(defaultFeeTokenAddress),
            takerFeeAssetData: assetDataUtils.encodeERC20AssetData(defaultFeeTokenAddress),
            feeRecipientAddress: feeRecipientAddressLeft,
            domain,
        };
        const defaultOrderParamsRight = {
            ...constants.STATIC_ORDER_PARAMS,
            makerAddress: makerAddressRight,
            makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
            takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
            makerFeeAssetData: assetDataUtils.encodeERC20AssetData(defaultFeeTokenAddress),
            takerFeeAssetData: assetDataUtils.encodeERC20AssetData(defaultFeeTokenAddress),
            feeRecipientAddress: feeRecipientAddressRight,
            domain,
        };
        const privateKeyLeft = constants.TESTRPC_PRIVATE_KEYS[accounts.indexOf(makerAddressLeft)];
        orderFactoryLeft = new OrderFactory(privateKeyLeft, defaultOrderParamsLeft);
        const privateKeyRight = constants.TESTRPC_PRIVATE_KEYS[accounts.indexOf(makerAddressRight)];
        orderFactoryRight = new OrderFactory(privateKeyRight, defaultOrderParamsRight);
        testExchange = await TestExchangeInternalsContract.deployFrom0xArtifactAsync(
            artifacts.TestExchangeInternals,
            provider,
            txDefaults,
            new BigNumber(chainId),
        );
        // Create match order tester
        matchOrderTester = new MatchOrderTester(exchangeWrapper, erc20Wrapper, erc721Wrapper, erc1155ProxyWrapper);
        tokenBalances = await matchOrderTester.getBalancesAsync();
    });
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });
    describe('matchOrders', () => {
        it('Should transfer correct amounts when right order is fully filled and values pass isRoundingErrorFloor but fail isRoundingErrorCeil', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(17, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(98, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(75, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(13, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            // Assert is rounding error ceil & not rounding error floor
            // These assertions are taken from MixinMatchOrders::calculateMatchedFillResults
            // The rounding error is derived computating how much the left maker will sell.
            const numerator = signedOrderLeft.makerAssetAmount;
            const denominator = signedOrderLeft.takerAssetAmount;
            const target = signedOrderRight.makerAssetAmount;
            const isRoundingErrorCeil = await testExchange.isRoundingErrorCeil.callAsync(
                numerator,
                denominator,
                target,
            );
            expect(isRoundingErrorCeil).to.be.true();
            const isRoundingErrorFloor = await testExchange.isRoundingErrorFloor.callAsync(
                numerator,
                denominator,
                target,
            );
            expect(isRoundingErrorFloor).to.be.false();
            // Match signedOrderLeft with signedOrderRight
            // Note that the left maker received a slightly better sell price.
            // This is intentional; see note in MixinMatchOrders.calculateMatchedFillResults.
            // Because the left maker received a slightly more favorable sell price, the fee
            // paid by the left taker is slightly higher than that paid by the left maker.
            // Fees can be thought of as a tax paid by the seller, derived from the sale price.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(13, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('76.4705882352941176'),
                    16,
                ), // 76.47%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(75, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('76.5306122448979591'),
                    16,
                ), // 76.53%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should transfer correct amounts when left order is fully filled and values pass isRoundingErrorCeil but fail isRoundingErrorFloor', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(15, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(90, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(97, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(14, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            // Assert is rounding error floor & not rounding error ceil
            // These assertions are taken from MixinMatchOrders::calculateMatchedFillResults
            // The rounding error is derived computating how much the right maker will buy.
            const numerator = signedOrderRight.takerAssetAmount;
            const denominator = signedOrderRight.makerAssetAmount;
            const target = signedOrderLeft.takerAssetAmount;
            const isRoundingErrorFloor = await testExchange.isRoundingErrorFloor.callAsync(
                numerator,
                denominator,
                target,
            );
            expect(isRoundingErrorFloor).to.be.true();
            const isRoundingErrorCeil = await testExchange.isRoundingErrorCeil.callAsync(
                numerator,
                denominator,
                target,
            );
            expect(isRoundingErrorCeil).to.be.false();
            // Match signedOrderLeft with signedOrderRight
            // Note that the right maker received a slightly better purchase price.
            // This is intentional; see note in MixinMatchOrders.calculateMatchedFillResults.
            // Because the right maker received a slightly more favorable buy price, the fee
            // paid by the right taker is slightly higher than that paid by the right maker.
            // Fees can be thought of as a tax paid by the seller, derived from the sale price.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(15, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(13, 0),
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(90, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('92.7835051546391752'),
                    16,
                ), // 92.78%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(2, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('92.8571428571428571'),
                    16,
                ), // 92.85%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should give right maker a better buy price when rounding', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(16, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(22, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(83, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(49, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            // Note:
            // The correct price buy price for the right maker would yield (49/83) * 22 = 12.988 units
            // of the left maker asset. This gets rounded up to 13, giving the right maker a better price.
            // Note:
            //  The maker/taker fee percentage paid on the right order differs because
            //  they received different sale prices. The right maker pays a
            //  fee slightly lower than the right taker.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(16, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(22, 0),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(13, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('26.5060240963855421'),
                    16,
                ), // 26.506%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('26.5306122448979591'),
                    16,
                ), // 26.531%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should give left maker a better sell price when rounding', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(12, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(97, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(89, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(1, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            // Note:
            //  The maker/taker fee percentage paid on the left order differs because
            //  they received different sale prices. The left maker pays a fee
            //  slightly lower than the left taker.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(11, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('91.6666666666666666'),
                    16,
                ), // 91.6%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(89, 0),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(1, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(10, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('91.7525773195876288'),
                    16,
                ), // 91.75%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should give right maker and right taker a favorable fee price when rounding', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(16, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(22, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(83, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(49, 0),
                feeRecipientAddress: feeRecipientAddressRight,
                makerFee: Web3Wrapper.toBaseUnitAmount(10000, 0),
                takerFee: Web3Wrapper.toBaseUnitAmount(10000, 0),
            });
            // Note:
            //  The maker/taker fee percentage paid on the right order differs because
            //  they received different sale prices. The right maker pays a
            //  fee slightly lower than the right taker.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(16, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(22, 0),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(13, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2650, 0), // 2650.6 rounded down tro 2650
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(2653, 0), // 2653.1 rounded down to 2653
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should give left maker and left taker a favorable fee price when rounding', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(12, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(97, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
                makerFee: Web3Wrapper.toBaseUnitAmount(10000, 0),
                takerFee: Web3Wrapper.toBaseUnitAmount(10000, 0),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(89, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(1, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            // Note:
            //  The maker/taker fee percentage paid on the left order differs because
            //  they received different sale prices. The left maker pays a
            //  fee slightly lower than the left taker.
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(11, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(9166, 0), // 9166.6 rounded down to 9166
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(89, 0),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(1, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(10, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(9175, 0), // 9175.2 rounded down to 9175
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should transfer correct amounts when right order fill amount deviates from amount derived by `Exchange.fillOrder`', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAddress: makerAddressLeft,
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(1000, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(1005, 0),
                feeRecipientAddress: feeRecipientAddressLeft,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAddress: makerAddressRight,
                makerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(2126, 0),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(1063, 0),
                feeRecipientAddress: feeRecipientAddressRight,
            });
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(1000, 0),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                // Notes:
                //  i.
                //    The left order is fully filled by the right order, so the right maker must sell 1005 units of their asset to the left maker.
                //    By selling 1005 units, the right maker should theoretically receive 502.5 units of the left maker's asset.
                //    Since the transfer amount must be an integer, this value must be rounded down to 502 or up to 503.
                //  ii.
                //    If the right order were filled via `Exchange.fillOrder` the respective fill amounts would be [1004, 502] or [1006, 503].
                //    It follows that we cannot trigger a sale of 1005 units of the right maker's asset through `Exchange.fillOrder`.
                //  iii.
                //    For an optimal match, the algorithm must choose either [1005, 502] or [1005, 503] as fill amounts for the right order.
                //    The algorithm favors the right maker when the exchange rate must be rounded, so the final fill for the right order is [1005, 503].
                //  iv.
                //    The right maker fee differs from the right taker fee because their exchange rate differs.
                //    The right maker always receives the better exchange and fee price.
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(1005, 0),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(503, 0),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('47.2718720602069614'),
                    16,
                ), // 47.27%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(497, 0),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(
                    new BigNumber('47.3189087488240827'),
                    16,
                ), // 47.31%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        const reentrancyTest = (functionNames: string[]) => {
            _.forEach(functionNames, async (functionName: string, functionId: number) => {
                const description = `should not allow matchOrders to reenter the Exchange contract via ${functionName}`;
                it(description, async () => {
                    const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                        makerAssetData: assetDataUtils.encodeERC20AssetData(reentrantErc20Token.address),
                        makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                        takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                    });
                    const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                        makerAddress: makerAddressRight,
                        takerAssetData: assetDataUtils.encodeERC20AssetData(reentrantErc20Token.address),
                        makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                        takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                        feeRecipientAddress: feeRecipientAddressRight,
                    });
                    await web3Wrapper.awaitTransactionSuccessAsync(
                        await reentrantErc20Token.setReentrantFunction.sendTransactionAsync(functionId),
                        constants.AWAIT_TRANSACTION_MINED_MS,
                    );
                    const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
                    return expect(tx).to.revertWith(RevertReason.ReentrancyIllegal);
                });
            });
        };
        describe('matchOrders reentrancy tests', () => reentrancyTest(exchangeConstants.FUNCTIONS_WITH_MUTEX));

        it('should transfer the correct amounts when orders completely fill each other', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match signedOrderLeft with signedOrderRight
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts when orders completely fill each other and taker doesnt take a profit', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
            });
            // Match signedOrderLeft with signedOrderRight
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts when left order is completely filled and right order is partially filled', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(20, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(4, 18),
            });
            // Match signedOrderLeft with signedOrderRight
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(50, 16), // 50%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(50, 16), // 50%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts when right order is completely filled and left order is partially filled', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(50, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match signedOrderLeft with signedOrderRight
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 16), // 10%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(10, 16), // 10%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            // Match signedOrderLeft with signedOrderRight
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts when consecutive calls are used to completely fill the left order', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(50, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 16), // 10%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(10, 16), // 10%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            // prettier-ignore
            const matchResults = await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
            // Construct second right order
            // Note: This order needs makerAssetAmount=90/takerAssetAmount=[anything <= 45] to fully fill the right order.
            //       However, we use 100/50 to ensure a partial fill as we want to go down the "left fill"
            //       branch in the contract twice for this test.
            const signedOrderRight2 = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(50, 18),
            });
            // Match signedOrderLeft with signedOrderRight2
            const expectedTransferAmounts2 = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(45, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(90, 16), // 90% (10% paid earlier)
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(90, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(90, 16), // 90%
                // Taker
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(90, 16), // 90% (10% paid earlier)
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(90, 16), // 90%
            };

            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight2,
                    leftOrderTakerAssetFilledAmount: matchResults.orders.leftOrderTakerAssetFilledAmount,
                },
                takerAddress,
                expectedTransferAmounts2,
                await matchOrderTester.getBalancesAsync(),
            );
        });

        it('should transfer the correct amounts when consecutive calls are used to completely fill the right order', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });

            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(50, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
            });
            // Match orders
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(4, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(4, 16), // 4%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(6, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(4, 16), // 4%
            };
            const matchResults = await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );

            // Create second left order
            // Note: This order needs makerAssetAmount=96/takerAssetAmount=48 to fully fill the right order.
            //       However, we use 100/50 to ensure a partial fill as we want to go down the "right fill"
            //       branch in the contract twice for this test.
            const signedOrderLeft2 = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(50, 18),
            });
            // Match signedOrderLeft2 with signedOrderRight
            const expectedTransferAmounts2 = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(96, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(96, 16), // 96%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(48, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(96, 16), // 96%
                // Taker
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(96, 16), // 96%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(96, 16), // 96%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft2,
                    rightOrder: signedOrderRight,
                    rightOrderTakerAssetFilledAmount: matchResults.orders.rightOrderTakerAssetFilledAmount,
                },
                takerAddress,
                expectedTransferAmounts2,
                await matchOrderTester.getBalancesAsync(),
            );
        });

        it('should transfer the correct amounts if fee recipient is the same across both matched orders', async () => {
            const feeRecipientAddress = feeRecipientAddressLeft;
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                feeRecipientAddress,
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                feeRecipientAddress,
            });
            // Match orders
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts if taker is also the left order maker', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            takerAddress = signedOrderLeft.makerAddress;
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts if taker is also the right order maker', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            takerAddress = signedOrderRight.makerAddress;
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts if taker is also the left fee recipient', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            takerAddress = feeRecipientAddressLeft;
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts if taker is also the right fee recipient', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            takerAddress = feeRecipientAddressRight;
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('should transfer the correct amounts if left maker is the left fee recipient and right maker is the right fee recipient', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // Match orders
            const expectedTransferAmounts = {
                // Left Maker
                leftMakerAssetSoldByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                leftMakerFeeAssetPaidByLeftMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Right Maker
                rightMakerAssetSoldByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                leftMakerAssetBoughtByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
                rightMakerFeeAssetPaidByRightMakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                // Taker
                leftMakerAssetReceivedByTakerAmount: Web3Wrapper.toBaseUnitAmount(3, 18),
                leftTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
                rightTakerFeeAssetPaidByTakerAmount: Web3Wrapper.toBaseUnitAmount(100, 16), // 100%
            };
            await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                {
                    leftOrder: signedOrderLeft,
                    rightOrder: signedOrderRight,
                },
                takerAddress,
                expectedTransferAmounts,
            );
        });

        it('Should throw if left order is not fillable', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            const orderHashHexLeft = orderHashUtils.getOrderHashHex(signedOrderLeft);
            // Cancel left order
            await exchangeWrapper.cancelOrderAsync(signedOrderLeft, signedOrderLeft.makerAddress);
            // Match orders
            const expectedError = new ExchangeRevertErrors.OrderStatusError(orderHashHexLeft, OrderStatus.Cancelled);
            const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
            return expect(tx).to.revertWith(expectedError);
        });

        it('Should throw if right order is not fillable', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            const orderHashHexRight = orderHashUtils.getOrderHashHex(signedOrderRight);
            // Cancel right order
            await exchangeWrapper.cancelOrderAsync(signedOrderRight, signedOrderRight.makerAddress);
            // Match orders
            const expectedError = new ExchangeRevertErrors.OrderStatusError(orderHashHexRight, OrderStatus.Cancelled);
            const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
            return expect(tx).to.revertWith(expectedError);
        });

        it('should throw if there is not a positive spread', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(100, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(1, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(200, 18),
            });
            const orderHashHexLeft = orderHashUtils.getOrderHashHex(signedOrderLeft);
            const orderHashHexRight = orderHashUtils.getOrderHashHex(signedOrderRight);
            // Match orders
            const expectedError = new ExchangeRevertErrors.NegativeSpreadError(orderHashHexLeft, orderHashHexRight);
            const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
            return expect(tx).to.revertWith(expectedError);
        });

        it('should throw if the left maker asset is not equal to the right taker asset ', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20TakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            // We are assuming assetData fields of the right order are the
            // reverse of the left order, rather than checking equality. This
            // saves a bunch of gas, but as a result if the assetData fields are
            // off then the failure ends up happening at signature validation
            const reconstructedOrderRight = {
                ...signedOrderRight,
                takerAssetData: signedOrderLeft.makerAssetData,
            };
            const orderHashHex = orderHashUtils.getOrderHashHex(reconstructedOrderRight);
            const expectedError = new ExchangeRevertErrors.SignatureError(
                ExchangeRevertErrors.SignatureErrorCode.BadSignature,
                orderHashHex,
                signedOrderRight.makerAddress,
                signedOrderRight.signature,
            );
            // Match orders
            const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
            return expect(tx).to.revertWith(expectedError);
        });

        it('should throw if the right maker asset is not equal to the left taker asset', async () => {
            // Create orders to match
            const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                takerAssetData: assetDataUtils.encodeERC20AssetData(defaultERC20MakerAssetAddress),
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(5, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
            });
            const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                makerAssetAmount: Web3Wrapper.toBaseUnitAmount(10, 18),
                takerAssetAmount: Web3Wrapper.toBaseUnitAmount(2, 18),
            });
            const reconstructedOrderRight = {
                ...signedOrderRight,
                makerAssetData: signedOrderLeft.takerAssetData,
            };
            const orderHashHex = orderHashUtils.getOrderHashHex(reconstructedOrderRight);
            const expectedError = new ExchangeRevertErrors.SignatureError(
                ExchangeRevertErrors.SignatureErrorCode.BadSignature,
                orderHashHex,
                signedOrderRight.makerAddress,
                signedOrderRight.signature,
            );
            // Match orders
            const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
            return expect(tx).to.revertWith(expectedError);
        });

        describe('combinations', () => {
            // tslint:disable: enum-naming
            enum AssetType {
                ERC20A = 'ERC20_A',
                ERC20B = 'ERC20_B',
                ERC20C = 'ERC20_C',
                ERC20D = 'ERC20_D',
                ERC721LeftMaker = 'ERC721_LEFT_MAKER',
                ERC721RightMaker = 'ERC721_RIGHT_MAKER',
                ERC721Taker = 'ERC721_TAKER',
                ERC1155FungibleA = 'ERC1155_FUNGIBLE_A',
                ERC1155FungibleB = 'ERC1155_FUNGIBLE_B',
                ERC1155FungibleC = 'ERC1155_FUNGIBLE_C',
                ERC1155FungibleD = 'ERC1155_FUNGIBLE_D',
                ERC1155NonFungibleLeftMaker = 'ERC1155_NON_FUNGIBLE_LEFT_MAKER',
                ERC1155NonFungibleRightMaker = 'ERC1155_NON_FUNGIBLE_RIGHT_MAKER',
                ERC1155NonFungibleTaker = 'ERC1155_NON_FUNGIBLE_TAKER',
                MultiAssetA = 'MULTI_ASSET_A',
                MultiAssetB = 'MULTI_ASSET_B',
                MultiAssetC = 'MULTI_ASSET_C',
                MultiAssetD = 'MULTI_ASSET_D',
            }
            const fungibleTypes = [
                AssetType.ERC20A,
                AssetType.ERC20B,
                AssetType.ERC20C,
                AssetType.ERC20D,
                AssetType.ERC1155FungibleA,
                AssetType.ERC1155FungibleB,
                AssetType.ERC1155FungibleC,
                AssetType.ERC1155FungibleD,
                AssetType.MultiAssetA,
                AssetType.MultiAssetB,
                AssetType.MultiAssetC,
                AssetType.MultiAssetD,
            ];
            interface AssetCombination {
                leftMaker: AssetType;
                rightMaker: AssetType;
                leftMakerFee: AssetType;
                rightMakerFee: AssetType;
                leftTakerFee: AssetType;
                rightTakerFee: AssetType;
                description?: string;
                shouldFail?: boolean;
            }
            const assetCombinations: AssetCombination[] = [
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC20B,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC721LeftMaker,
                    rightMaker: AssetType.ERC721RightMaker,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC721LeftMaker,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC721RightMaker,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155FungibleA,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC1155FungibleB,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155FungibleA,
                    rightMaker: AssetType.ERC1155FungibleA,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155NonFungibleLeftMaker,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC1155NonFungibleRightMaker,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155NonFungibleLeftMaker,
                    rightMaker: AssetType.ERC1155NonFungibleRightMaker,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155FungibleA,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC1155FungibleB,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC1155FungibleB,
                    rightMaker: AssetType.ERC1155FungibleB,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.MultiAssetB,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.MultiAssetB,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC20C,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.ERC1155FungibleA,
                    leftMakerFee: AssetType.ERC1155FungibleA,
                    rightMakerFee: AssetType.MultiAssetA,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                },
                {
                    description: 'Paying maker fees with the same ERC20 tokens being bought.',
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC20B,
                    leftMakerFee: AssetType.ERC20B,
                    rightMakerFee: AssetType.ERC20A,
                    leftTakerFee: AssetType.ERC20B,
                    rightTakerFee: AssetType.ERC20A,
                },
                {
                    description: 'Paying maker fees with the same ERC20 tokens being sold.',
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC20B,
                    leftMakerFee: AssetType.ERC20A,
                    rightMakerFee: AssetType.ERC20B,
                    leftTakerFee: AssetType.ERC20A,
                    rightTakerFee: AssetType.ERC20B,
                },
                {
                    description: 'Using all the same ERC20 asset.',
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC20A,
                    leftMakerFee: AssetType.ERC20A,
                    rightMakerFee: AssetType.ERC20A,
                    leftTakerFee: AssetType.ERC20A,
                    rightTakerFee: AssetType.ERC20A,
                },
                {
                    description: 'Paying fees with the same MAP assets being sold.',
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.MultiAssetB,
                    leftMakerFee: AssetType.MultiAssetA,
                    rightMakerFee: AssetType.MultiAssetB,
                    leftTakerFee: AssetType.MultiAssetA,
                    rightTakerFee: AssetType.MultiAssetB,
                },
                {
                    description: 'Paying fees with the same MAP assets being bought.',
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.MultiAssetB,
                    leftMakerFee: AssetType.MultiAssetB,
                    rightMakerFee: AssetType.MultiAssetA,
                    leftTakerFee: AssetType.MultiAssetB,
                    rightTakerFee: AssetType.MultiAssetA,
                },
                {
                    description: 'Using all the same MAP assets.',
                    leftMaker: AssetType.MultiAssetA,
                    rightMaker: AssetType.MultiAssetA,
                    leftMakerFee: AssetType.MultiAssetA,
                    rightMakerFee: AssetType.MultiAssetA,
                    leftTakerFee: AssetType.MultiAssetA,
                    rightTakerFee: AssetType.MultiAssetA,
                },
                {
                    description: 'Swapping ERC721s then using them to pay maker fees.',
                    leftMaker: AssetType.ERC721LeftMaker,
                    rightMaker: AssetType.ERC721RightMaker,
                    leftMakerFee: AssetType.ERC721RightMaker,
                    rightMakerFee: AssetType.ERC721LeftMaker,
                    leftTakerFee: AssetType.ERC20A,
                    rightTakerFee: AssetType.ERC20A,
                },
                {
                    description: 'Swapping ERC1155 NFTs then using them to pay maker fees.',
                    leftMaker: AssetType.ERC1155NonFungibleLeftMaker,
                    rightMaker: AssetType.ERC1155NonFungibleRightMaker,
                    leftMakerFee: AssetType.ERC1155NonFungibleRightMaker,
                    rightMakerFee: AssetType.ERC1155NonFungibleLeftMaker,
                    leftTakerFee: AssetType.ERC20A,
                    rightTakerFee: AssetType.ERC20A,
                },
                {
                    description: 'Double-spend by trying to pay maker fees with sold ERC721 token (fail).',
                    leftMaker: AssetType.ERC721LeftMaker,
                    rightMaker: AssetType.ERC721RightMaker,
                    leftMakerFee: AssetType.ERC721LeftMaker,
                    rightMakerFee: AssetType.ERC721LeftMaker,
                    leftTakerFee: AssetType.ERC20A,
                    rightTakerFee: AssetType.ERC20A,
                    shouldFail: true,
                },
                {
                    description: 'Double-spend by trying to pay maker fees with sold ERC1155 NFT (fail).',
                    leftMaker: AssetType.ERC20A,
                    rightMaker: AssetType.ERC1155NonFungibleLeftMaker,
                    leftMakerFee: AssetType.ERC20C,
                    rightMakerFee: AssetType.ERC1155NonFungibleLeftMaker,
                    leftTakerFee: AssetType.ERC20C,
                    rightTakerFee: AssetType.ERC20C,
                    shouldFail: true,
                },
            ];

            let nameToERC20Asset: { [name: string]: string };
            let nameToERC721Asset: { [name: string]: [string, BigNumber] };
            let nameToERC1155FungibleAsset: { [name: string]: [string, BigNumber] };
            let nameToERC1155NonFungibleAsset: { [name: string]: [string, BigNumber] };
            let nameToMultiAssetAsset: { [name: string]: [BigNumber[], string[]] };

            function getAssetData(assetType: AssetType): string {
                const encodeERC20AssetData = assetDataUtils.encodeERC20AssetData;
                const encodeERC721AssetData = assetDataUtils.encodeERC721AssetData;
                const encodeERC1155AssetData = assetDataUtils.encodeERC1155AssetData;
                const encodeMultiAssetData = assetDataUtils.encodeMultiAssetData;
                if (nameToERC20Asset[assetType] !== undefined) {
                    const tokenAddress = nameToERC20Asset[assetType];
                    return encodeERC20AssetData(tokenAddress);
                }
                if (nameToERC721Asset[assetType] !== undefined) {
                    const [tokenAddress, tokenId] = nameToERC721Asset[assetType];
                    return encodeERC721AssetData(tokenAddress, tokenId);
                }
                if (nameToERC1155FungibleAsset[assetType] !== undefined) {
                    const [tokenAddress, tokenId] = nameToERC1155FungibleAsset[assetType];
                    return encodeERC1155AssetData(tokenAddress, [tokenId], [ONE], constants.NULL_BYTES);
                }
                if (nameToERC1155NonFungibleAsset[assetType] !== undefined) {
                    const [tokenAddress, tokenId] = nameToERC1155NonFungibleAsset[assetType];
                    return encodeERC1155AssetData(tokenAddress, [tokenId], [ONE], constants.NULL_BYTES);
                }
                if (nameToMultiAssetAsset[assetType] !== undefined) {
                    const [amounts, nestedAssetData] = nameToMultiAssetAsset[assetType];
                    return encodeMultiAssetData(amounts, nestedAssetData);
                }
                throw new Error(`Unknown asset type: ${assetType}`);
            }

            before(async () => {
                nameToERC20Asset = {
                    ERC20_A: erc20Tokens[0].address,
                    ERC20_B: erc20Tokens[1].address,
                    ERC20_C: erc20Tokens[2].address,
                    ERC20_D: erc20Tokens[3].address,
                };
                const erc721TokenIds = _.mapValues(tokenBalances.erc721, v => v[defaultERC721AssetAddress.address][0]);
                nameToERC721Asset = {
                    ERC721_LEFT_MAKER: [defaultERC721AssetAddress.address, erc721TokenIds[makerAddressLeft]],
                    ERC721_RIGHT_MAKER: [defaultERC721AssetAddress.address, erc721TokenIds[makerAddressRight]],
                    ERC721_TAKER: [defaultERC721AssetAddress.address, erc721TokenIds[takerAddress]],
                };
                const erc1155FungibleTokens = _.keys(
                    _.values(tokenBalances.erc1155)[0][defaultERC1155AssetAddress].fungible,
                ).map(k => new BigNumber(k));
                nameToERC1155FungibleAsset = {
                    ERC1155_FUNGIBLE_A: [defaultERC1155AssetAddress, erc1155FungibleTokens[0]],
                    ERC1155_FUNGIBLE_B: [defaultERC1155AssetAddress, erc1155FungibleTokens[1]],
                    ERC1155_FUNGIBLE_C: [defaultERC1155AssetAddress, erc1155FungibleTokens[2]],
                    ERC1155_FUNGIBLE_D: [defaultERC1155AssetAddress, erc1155FungibleTokens[3]],
                };
                const erc1155NonFungibleTokenIds = _.mapValues(
                    tokenBalances.erc1155,
                    v => v[defaultERC1155AssetAddress].nonFungible[0],
                );
                nameToERC1155NonFungibleAsset = {
                    ERC1155_NON_FUNGIBLE_LEFT_MAKER: [
                        defaultERC1155AssetAddress,
                        erc1155NonFungibleTokenIds[makerAddressLeft],
                    ],
                    ERC1155_NON_FUNGIBLE_RIGHT_MAKER: [
                        defaultERC1155AssetAddress,
                        erc1155NonFungibleTokenIds[makerAddressRight],
                    ],
                    ERC1155_NON_FUNGIBLE_TAKER: [defaultERC1155AssetAddress, erc1155NonFungibleTokenIds[takerAddress]],
                };
                nameToMultiAssetAsset = {
                    MULTI_ASSET_A: [
                        [ONE, TWO],
                        [
                            assetDataUtils.encodeERC20AssetData(erc20Tokens[0].address),
                            assetDataUtils.encodeERC1155AssetData(
                                defaultERC1155AssetAddress,
                                [erc1155FungibleTokens[0]],
                                [ONE],
                                constants.NULL_BYTES,
                            ),
                        ],
                    ],
                    MULTI_ASSET_B: [
                        [ONE, TWO],
                        [
                            assetDataUtils.encodeERC20AssetData(erc20Tokens[1].address),
                            assetDataUtils.encodeERC1155AssetData(
                                defaultERC1155AssetAddress,
                                [erc1155FungibleTokens[1]],
                                [ONE],
                                constants.NULL_BYTES,
                            ),
                        ],
                    ],
                    MULTI_ASSET_C: [
                        [ONE, TWO],
                        [
                            assetDataUtils.encodeERC20AssetData(erc20Tokens[2].address),
                            assetDataUtils.encodeERC1155AssetData(
                                defaultERC1155AssetAddress,
                                [erc1155FungibleTokens[2]],
                                [ONE],
                                constants.NULL_BYTES,
                            ),
                        ],
                    ],
                    MULTI_ASSET_D: [
                        [ONE, TWO],
                        [
                            assetDataUtils.encodeERC20AssetData(erc20Tokens[3].address),
                            assetDataUtils.encodeERC1155AssetData(
                                erc1155Token.address,
                                [erc1155FungibleTokens[3]],
                                [ONE],
                                constants.NULL_BYTES,
                            ),
                        ],
                    ],
                };
            });

            for (const combo of assetCombinations) {
                const description = combo.description || JSON.stringify(combo);
                it(description, async () => {
                    // Create orders to match. For ERC20s, there will be a spread.
                    const leftMakerAssetAmount = _.includes(fungibleTypes, combo.leftMaker)
                        ? Web3Wrapper.toBaseUnitAmount(15, 18)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const leftTakerAssetAmount = _.includes(fungibleTypes, combo.rightMaker)
                        ? Web3Wrapper.toBaseUnitAmount(30, 18)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const rightMakerAssetAmount = _.includes(fungibleTypes, combo.rightMaker)
                        ? Web3Wrapper.toBaseUnitAmount(30, 18)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const rightTakerAssetAmount = _.includes(fungibleTypes, combo.leftMaker)
                        ? Web3Wrapper.toBaseUnitAmount(14, 18)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const leftMakerFeeAssetAmount = _.includes(fungibleTypes, combo.leftMakerFee)
                        ? Web3Wrapper.toBaseUnitAmount(8, 12)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const rightMakerFeeAssetAmount = _.includes(fungibleTypes, combo.rightMakerFee)
                        ? Web3Wrapper.toBaseUnitAmount(7, 12)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const leftTakerFeeAssetAmount = _.includes(fungibleTypes, combo.leftTakerFee)
                        ? Web3Wrapper.toBaseUnitAmount(6, 12)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const rightTakerFeeAssetAmount = _.includes(fungibleTypes, combo.rightTakerFee)
                        ? Web3Wrapper.toBaseUnitAmount(5, 12)
                        : Web3Wrapper.toBaseUnitAmount(1, 0);
                    const leftMakerAssetReceivedByTakerAmount = _.includes(fungibleTypes, combo.leftMaker)
                        ? leftMakerAssetAmount.minus(rightTakerAssetAmount)
                        : Web3Wrapper.toBaseUnitAmount(0, 0);
                    const signedOrderLeft = await orderFactoryLeft.newSignedOrderAsync({
                        makerAssetData: getAssetData(combo.leftMaker),
                        takerAssetData: getAssetData(combo.rightMaker),
                        makerFeeAssetData: getAssetData(combo.leftMakerFee),
                        takerFeeAssetData: getAssetData(combo.leftTakerFee),
                        makerAssetAmount: leftMakerAssetAmount,
                        takerAssetAmount: leftTakerAssetAmount,
                        makerFee: leftMakerFeeAssetAmount,
                        takerFee: leftTakerFeeAssetAmount,
                    });
                    const signedOrderRight = await orderFactoryRight.newSignedOrderAsync({
                        makerAssetData: getAssetData(combo.rightMaker),
                        takerAssetData: getAssetData(combo.leftMaker),
                        makerFeeAssetData: getAssetData(combo.rightMakerFee),
                        takerFeeAssetData: getAssetData(combo.rightTakerFee),
                        makerAssetAmount: rightMakerAssetAmount,
                        takerAssetAmount: rightTakerAssetAmount,
                        makerFee: rightMakerFeeAssetAmount,
                        takerFee: rightTakerFeeAssetAmount,
                    });
                    // Match signedOrderLeft with signedOrderRight
                    const expectedTransferAmounts = {
                        // Left Maker
                        leftMakerAssetSoldByLeftMakerAmount: leftMakerAssetAmount,
                        leftMakerFeeAssetPaidByLeftMakerAmount: leftMakerFeeAssetAmount,
                        // Right Maker
                        rightMakerAssetSoldByRightMakerAmount: rightMakerAssetAmount,
                        leftMakerAssetBoughtByRightMakerAmount: rightTakerAssetAmount,
                        rightMakerFeeAssetPaidByRightMakerAmount: rightMakerFeeAssetAmount,
                        // Taker
                        leftMakerAssetReceivedByTakerAmount,
                        leftTakerFeeAssetPaidByTakerAmount: leftTakerFeeAssetAmount,
                        rightTakerFeeAssetPaidByTakerAmount: rightTakerFeeAssetAmount,
                    };
                    if (!combo.shouldFail) {
                        await matchOrderTester.matchOrdersAndAssertEffectsAsync(
                            {
                                leftOrder: signedOrderLeft,
                                rightOrder: signedOrderRight,
                            },
                            takerAddress,
                            expectedTransferAmounts,
                        );
                    } else {
                        const tx = exchangeWrapper.matchOrdersAsync(signedOrderLeft, signedOrderRight, takerAddress);
                        return expect(tx).to.be.rejected();
                    }
                });
            }
        });
    });
});
// tslint:disable-line:max-file-line-count
