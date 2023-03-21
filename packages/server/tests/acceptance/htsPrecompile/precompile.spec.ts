/*-
 *
 * Hedera JSON RPC Relay
 *
 * Copyright (C) 2022 Hedera Hashgraph, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// external resources
import { solidity } from 'ethereum-waffle';
import chai, { expect } from 'chai';

chai.use(solidity);

import { AliasAccount } from '../../clients/servicesClient';
import {BigNumber, ethers} from 'ethers';
import IERC20MetadataJson from '../../contracts/openzeppelin/IERC20Metadata.json';
import IERC20Json from '../../contracts/openzeppelin/IERC20.json';
import IERC721MetadataJson from '../../contracts/openzeppelin/IERC721Metadata.json';
import IERC721EnumerableJson from '../../contracts/openzeppelin/IERC721Enumerable.json';
import IERC721Json from '../../contracts/openzeppelin/IERC721.json';
import IHederaTokenServiceJson from '../../contracts/IHederaTokenService.json';
import HederaTokenServiceImplJson from '../../contracts/HederaTokenServiceImpl.json';
import TokenManagementContractJson from '../../contracts/TokenManagementContract.json';

import { Utils } from '../../helpers/utils';

describe('@precompile Tests for eth_call with HTS', async function () {
    this.timeout(240 * 1000); // 240 seconds
    const { servicesNode, mirrorNode, relay } = global;

    const TX_SUCCESS_CODE = 22;

    const TOKEN_NAME = Utils.randomString(10);
    const TOKEN_SYMBOL = Utils.randomString(5);
    const INITIAL_SUPPLY = 100000;
    const TOKEN_DECIMALS = 18;

    const NFT_NAME = Utils.randomString(10);
    const NFT_SYMBOL = Utils.randomString(5);
    const NFT_MAX_SUPPLY = 100;
    const NFT_METADATA = 'ABCDE';

    const accounts: AliasAccount[] = [];
    let requestId;

    let IERC20Metadata, IERC20, IERC721Metadata, IERC721Enumerable, IERC721, IHederaTokenService, TokenManager;
    let nftSerial, tokenAddress, nftAddress, htsImplAddress, htsImpl, adminAccountLongZero;

    let tokenAddressFixedHbarFees, tokenAddressFixedTokenFees, tokenAddressNoFees,
        tokenAddressFractionalFees, nftAddressFractionalFees;

    before(async () => {
        requestId = Utils.generateRequestId();

        // create accounts
        accounts[0] = await servicesNode.createAliasAccount(200, relay.provider, requestId);
        accounts[1] = await servicesNode.createAliasAccount(200, relay.provider, requestId);
        accounts[2] = await servicesNode.createAliasAccount(200, relay.provider, requestId);

        await new Promise(r => setTimeout(r, 5000));
        await mirrorNode.get(`/accounts/${accounts[0].accountId}`, requestId);
        await mirrorNode.get(`/accounts/${accounts[1].accountId}`, requestId);
        await mirrorNode.get(`/accounts/${accounts[2].accountId}`, requestId);

        // Create tokens
        const defaultTokenOptions = {
            tokenName: TOKEN_NAME,
            symbol: TOKEN_SYMBOL,
            treasuryAccountId: accounts[0].accountId.toString(),
            initialSupply: INITIAL_SUPPLY,
            adminPrivateKey: accounts[0].privateKey,
            kyc: true,
            freeze: true
        };

        const defaultNftOptions = {
            tokenName: NFT_NAME,
            symbol: NFT_SYMBOL,
            treasuryAccountId: accounts[0].accountId.toString(),
            maxSupply: NFT_MAX_SUPPLY,
            adminPrivateKey: accounts[0].privateKey
        };

        // HTS token with no custom fees
        const htsResult0 = await servicesNode.createHTS(defaultTokenOptions);

        // HTS token with custom fixed HBAR fee
        const htsResult1 = await servicesNode.createHTS({
            ...defaultTokenOptions,
            customHbarFees: 1
        });

        // HTS token with custom fixed token fee
        const htsResult2 = await servicesNode.createHTS({
            ...defaultTokenOptions,
            customTokenFees: 1
        });

        // HTS token with custom fixed fractional fee
        const htsResult3 = await servicesNode.createHTS({
            ...defaultTokenOptions,
            customFractionalFees: 1
        });

        // NFT with no custom fees
        const nftResult0 = await servicesNode.createNFT(defaultNftOptions);

        // NFT with no custom royalty fees
        const nftResult1 = await servicesNode.createNFT({
            ...defaultNftOptions,
            customRoyaltyFees: 1
        });

        const nftTokenId0 = nftResult0.receipt.tokenId.toString();
        const nftTokenId1 = nftResult1.receipt.tokenId.toString();

        const mintArgs = {
            metadata: NFT_METADATA,
            treasuryAccountId: accounts[0].accountId.toString(),
            adminPrivateKey: accounts[0].privateKey
        };
        const mintResult0 = await servicesNode.mintNFT({...mintArgs, tokenId: nftTokenId0});
        const mintResult1 = await servicesNode.mintNFT({...mintArgs, tokenId: nftTokenId1});

        // associate tokens, grant KYC
        for (let account of [accounts[1], accounts[2]]) {
            await servicesNode.associateHTSToken(account.accountId, htsResult1.receipt.tokenId, account.privateKey, htsResult1.client, requestId);
            await servicesNode.grantKyc({
                tokenId: htsResult1.receipt.tokenId,
                treasuryAccountId: accounts[0].accountId.toString(),
                adminPrivateKey: accounts[0].privateKey,
                accountId: account.accountId
            });

            await servicesNode.associateHTSToken(account.accountId, nftResult0.receipt.tokenId, account.privateKey, nftResult0.client, requestId);
        }

        // create contract instances
        tokenAddress = Utils.idToEvmAddress(htsResult1.receipt.tokenId.toString());
        tokenAddressFixedHbarFees = tokenAddress;
        tokenAddressFixedTokenFees = Utils.idToEvmAddress(htsResult2.receipt.tokenId.toString());
        tokenAddressNoFees = Utils.idToEvmAddress(htsResult0.receipt.tokenId.toString());
        tokenAddressFractionalFees = Utils.idToEvmAddress(htsResult3.receipt.tokenId.toString());

        nftAddress = Utils.idToEvmAddress(nftTokenId0);
        nftAddressFractionalFees = Utils.idToEvmAddress(nftTokenId1);

        IERC20Metadata = getContract(tokenAddress, IERC20MetadataJson.abi, accounts[0].wallet);
        IERC20 = getContract(tokenAddress, IERC20Json.abi, accounts[0].wallet);
        IHederaTokenService = getContract(tokenAddress, IHederaTokenServiceJson.abi, accounts[0].wallet);


        nftSerial = mintResult0.receipt.serials[0].low;
        IERC721Metadata = getContract(nftAddress, IERC721MetadataJson.abi, accounts[0].wallet);
        IERC721Enumerable = getContract(nftAddress, IERC721EnumerableJson.abi, accounts[0].wallet);
        IERC721 = getContract(nftAddress, IERC721Json.abi, accounts[0].wallet);

        adminAccountLongZero = Utils.idToEvmAddress(accounts[0].accountId.toString());

        // Transfer and approve token amounts
        const rec1 = await IERC20.transfer(accounts[1].address, 100, { gasLimit: 1_000_000 });
        await rec1.wait();
        const rec2 = await IERC20.approve(accounts[2].address, 200, { gasLimit: 1_000_000 });
        await rec2.wait();

        const rec3 = await IERC721.transferFrom(accounts[0].address, accounts[1].address, nftSerial, { gasLimit: 1_000_000 });
        await rec3.wait();
        const rec4 = await IERC721.connect(accounts[1].wallet).approve(accounts[2].address, nftSerial, { gasLimit: 1_000_000 });
        await rec4.wait();
        const rec5 = await IERC721.connect(accounts[1].wallet).setApprovalForAll(accounts[0].address, nftSerial, { gasLimit: 1_000_000 });
        await rec5.wait();

        // Deploy a contract implementing HederaTokenService
        const HederaTokenServiceImplFactory = new ethers.ContractFactory(HederaTokenServiceImplJson.abi, HederaTokenServiceImplJson.bytecode, accounts[0].wallet);
        htsImpl = await HederaTokenServiceImplFactory.deploy({gasLimit: 15000000});

        const rec6 = await htsImpl.deployTransaction.wait();
        htsImplAddress = rec6.contractAddress;

        // Deploy the Token Management contract
        const TokenManagementContractFactory = new ethers.ContractFactory(TokenManagementContractJson.abi, TokenManagementContractJson.bytecode, accounts[0].wallet);
        TokenManager = await TokenManagementContractFactory.deploy({gasLimit: 15000000});
        const rec7 = await htsImpl.deployTransaction.wait();
    });

    this.beforeEach(async () => {
        requestId = Utils.generateRequestId();
    });

    function getContract(address, abi, wallet) {
        return new ethers.Contract(address, abi, wallet);
    }

    //
    // it('balanceOf', async () => {
    //     const balance = await htsContract.balanceOf(accounts[0].address);
    //     expect(balance).to.exist;
    //     expect(balance.toString()).to.eq("1000");
    // });
    //
    // it('isTokenAddress', async () => {
    //     const mainContract = new ethers.Contract(mainContractAddress, MainContractJson.abi, accounts[0].wallet);
    //     const result = await mainContract.isTokenAddress(htsContract.address);
    //     expect(result).to.eq(true);
    // });

    describe("Calling HTS token through IERC20Metadata", async () => {
        it("ETHCALL-011 - Function with IERC20Metadata(token).name()", async () => {
            const name = await IERC20Metadata.name();
            expect(name).to.eq(TOKEN_NAME);
        });

        it("ETHCALL-012 - Function with IERC20Metadata(token).symbol()", async () => {
            const symbol = await IERC20Metadata.symbol();
            expect(symbol).to.eq(TOKEN_SYMBOL);
        });

        it("ETHCALL-013 - Function with IERC20Metadata(token).decimals()", async () => {
            const decimals = await IERC20Metadata.decimals();
            expect(decimals).to.eq(TOKEN_DECIMALS);
        });
    })

    describe("Calling HTS token through IERC20", async () => {
        it("ETHCALL-014 - Function with IERC20(token).totalSupply()", async () => {
            const totalSupply = await IERC20Metadata.totalSupply();
            expect(totalSupply).to.eq(INITIAL_SUPPLY);
        });

        it("ETHCALL-015 - Function with IERC20(token).balanceOf(account)", async () => {
            const balance = await IERC20.balanceOf(accounts[1].address);
            expect(balance).to.eq(100);
        });

        it("ETHCALL-016 - Function with IERC20(token).allowance(owner, spender)", async () => {
            const allowance = await IERC20.allowance(accounts[0].address, accounts[2].address);
            expect(allowance).to.eq(200);
        });
    });

    describe("Calling HTS token through IERC721Metadata", async () => {
        it("ETHCALL-017 - Function with IERC721Metadata(token).name()", async () => {
            const name = await IERC721Metadata.name();
            expect(name).to.eq(NFT_NAME);
        });

        it("ETHCALL-018 - Function with IERC721Metadata(token).symbol()", async () => {
            const symbol = await IERC721Metadata.symbol();
            expect(symbol).to.eq(NFT_SYMBOL);
        });

        it("ETHCALL-024 - Function with IERC721Metadata(token).tokenURI(tokenId)", async () => {
            const tokenURI = await IERC721Metadata.tokenURI(nftSerial);
            expect(tokenURI).to.eq(NFT_METADATA);
        });
    });

    describe("Calling HTS token through IERC721Enumerable", async () => {
        it("ETHCALL-019 - Function with IERC721Enumerable(token).totalSupply()", async () => {
            const supply = await IERC721Enumerable.totalSupply();
            expect(supply).to.eq(1);
        });
    });

    describe("Calling HTS token through IERC721", async () => {
        it("ETHCALL-020 - Function with IERC721(token).balanceOf(owner)", async () => {
            const balance0 = await IERC721.balanceOf(accounts[0].address);
            expect(balance0).to.eq(0);

            const balance1 = await IERC721.balanceOf(accounts[1].address);
            expect(balance1).to.eq(1);

            const balance2 = await IERC721.balanceOf(accounts[2].address);
            expect(balance2).to.eq(0);

        });

        it("ETHCALL-021 - Function with IERC721(token).getApproved(serialNo)", async () => {
            const approval = await IERC721.getApproved(nftSerial);
            expect(approval.toLowerCase()).to.eq(`0x${accounts[2].address}`);
        });

        it("ETHCALL-022 - Function with IERC721(token).isApprovedForAll(owner, operator)", async () => {
            const approvalForAll = await IERC721.isApprovedForAll(accounts[1].address, accounts[0].address);
            expect(approvalForAll).to.eq(true);
        });

        it("ETHCALL-023 - Function with IERC721(token).ownerOf(serialNo)", async () => {
            const owner = await IERC721.ownerOf(nftSerial);
            expect(owner.toLowerCase()).to.eq(`0x${accounts[1].address}`);
        });
    });

    describe("Calling HTS token through HederaTokenService", async () => {
        it("ETHCALL-025 - Function with HederaTokenService.isToken(token)", async () => {
            const isToken = await htsImpl.callStatic.isTokenAddress(tokenAddress);
            expect(isToken).to.eq(true);
        });

        it("ETHCALL-026 - Function with HederaTokenService.isFrozen(token, account)", async () => {
            // freeze token
            const freezeTx = await TokenManager.freezeTokenPublic(tokenAddress, accounts[1].wallet.address, { gasLimit: 1_000_000 });
            const responseCodeFreeze = (await freezeTx.wait()).events.filter(e => e.event === 'ResponseCode')[0].args.responseCode;
            expect(responseCodeFreeze).to.equal(TX_SUCCESS_CODE);

            const isFrozen = await htsImpl.callStatic.isTokenFrozen(tokenAddress, accounts[1].address);
            expect(isFrozen).to.eq(true);

            // unfreeze token
            const unfreezeTx = await TokenManager.unfreezeTokenPublic(tokenAddress, accounts[1].wallet.address, { gasLimit: 1_000_000 });
            const responseCodeUnfreeze = (await unfreezeTx.wait()).events.filter(e => e.event === 'ResponseCode')[0].args.responseCode;
            expect(responseCodeUnfreeze).to.equal(TX_SUCCESS_CODE);
        });

        it("ETHCALL-027 - Function with HederaTokenService.isKyc(token, account)", async () => {
            const isKyc1 = await htsImpl.callStatic.isKycGranted(tokenAddress, accounts[1].address);
            expect(isKyc1).to.eq(true);

        });

        it("ETHCALL-028 - Function with HederaTokenService.getTokenDefaultFreezeStatus(token)", async () => {
            const defaultFreeze = await htsImpl.callStatic.getTokenDefaultFreeze(tokenAddress);
            expect(defaultFreeze).to.eq(false);
        });

        it("ETHCALL-029 - Function with HederaTokenService.getTokenDefaultKycStatus(token)", async () => {
            const defaultKyc = await htsImpl.callStatic.getTokenDefaultKyc(tokenAddress);
            expect(defaultKyc).to.eq(true);
        });

        describe.only("ETHCALL-030 - Function with HederaTokenService.getTokenCustomFees(token)", async () => {
            it("token with no custom fees", async () => {
                const customFees = await htsImpl.callStatic.getCustomFeesForToken(tokenAddressNoFees);
                expect(customFees).to.exist;
                expect(customFees.fixedFees).to.exist;
                expect(customFees.fixedFees.length).to.eq(0);
            });


            it("token with fixed hbar fees", async () => {
                const customFees = await htsImpl.callStatic.getCustomFeesForToken(tokenAddressFixedHbarFees);
                expect(customFees).to.exist;
                expect(customFees.fixedFees).to.exist;
                expect(customFees.fixedFees.length).to.eq(1);
                expect(customFees.fixedFees[0].amount).to.exist;
                expect(customFees.fixedFees[0].amount.toString()).to.eq("1");
                expect(customFees.fixedFees[0].tokenId).to.eq("0x0000000000000000000000000000000000000000");
                expect(customFees.fixedFees[0].feeCollector).to.eq(adminAccountLongZero);
            });

            it("token with fixed token fees", async () => {
                const customFees = await htsImpl.callStatic.getCustomFeesForToken(tokenAddressFixedTokenFees);
                expect(customFees).to.exist;
                expect(customFees.fixedFees).to.exist;
                expect(customFees.fixedFees.length).to.eq(1);
                expect(customFees.fixedFees[0].amount).to.exist;
                expect(customFees.fixedFees[0].amount.toString()).to.eq("1");
                expect(customFees.fixedFees[0].tokenId).to.eq("0x0000000000000000000000000000000000000000");
                expect(customFees.fixedFees[0].feeCollector).to.eq(adminAccountLongZero);
            });

            it("token with fractional fees", async () => {
                const customFees = await htsImpl.callStatic.getCustomFeesForToken(tokenAddressFractionalFees);
                expect(customFees).to.exist;
                expect(customFees.fixedFees).to.exist;
                expect(customFees.fixedFees.length).to.eq(1);
                expect(customFees.fixedFees[0].amount).to.exist;
                expect(customFees.fixedFees[0].amount.toString()).to.eq("1");
                expect(customFees.fixedFees[0].tokenId).to.eq("0x0000000000000000000000000000000000000000");
                expect(customFees.fixedFees[0].feeCollector).to.eq(adminAccountLongZero);
            });
        });




        xit("ETHCALL-031 - Function with HederaTokenService.getTokenCustomFees(token)", async () => {
        });

        xit("ETHCALL-032 - Function with HederaTokenService.getTokenCustomFees(token)", async () => {
        });

        xit("ETHCALL-033 - Function with HederaTokenService.getTokenInfo(token)", async () => {
            const info = await htsImpl.callStatic.getInformationForToken(tokenAddress);
            expect(info).to.exist;
            expect(info.token).to.exist;
            expect(info.token.name).to.eq(TOKEN_NAME);
            expect(info.token.symbol).to.eq(TOKEN_SYMBOL);
            expect(info.token.treasury.toLowerCase()).to.eq(adminAccountLongZero.toLowerCase());
            expect(info.totalSupply).to.exist;
            expect(info.totalSupply.toString()).to.eq(INITIAL_SUPPLY.toString());
        });

        it("ETHCALL-034 - Function with HederaTokenService.getFungibleTokenInfo(token)", async () => {
            const info = await htsImpl.callStatic.getInformationForFungibleToken(tokenAddress);
            expect(info).to.exist;
            expect(info.tokenInfo).to.exist;
            expect(info.tokenInfo.token).to.exist;
            expect(info.tokenInfo.token.name).to.eq(TOKEN_NAME);
            expect(info.tokenInfo.token.symbol).to.eq(TOKEN_SYMBOL);
            expect(info.tokenInfo.token.treasury.toLowerCase()).to.eq(adminAccountLongZero.toLowerCase());
            expect(info.tokenInfo.totalSupply).to.exist;
            expect(info.tokenInfo.totalSupply.toString()).to.eq(INITIAL_SUPPLY.toString());
        });

        it("ETHCALL-035 - Function with HederaTokenService.getNonFungibleTokenInfo(token, serialNumber)", async () => {
            const info = await htsImpl.callStatic.getInformationForNonFungibleToken(nftAddress, nftSerial);
            expect(info).to.exist;
            expect(info.tokenInfo.token).to.exist;
            expect(info.tokenInfo.token.name).to.eq(NFT_NAME);
            expect(info.tokenInfo.token.symbol).to.eq(NFT_SYMBOL);
            expect(info.tokenInfo.token.treasury.toLowerCase()).to.eq(adminAccountLongZero.toLowerCase());
            expect(info.serialNumber.toString()).to.eq(nftSerial.toString());
        });

        it("ETHCALL-036 - Function with HederaTokenService.getTokenExpiryInfo(token)", async () => {
            const expiryInfo = await htsImpl.callStatic.getExpiryInfoForToken(tokenAddress);
            expect(expiryInfo).to.exist;
            expect(expiryInfo.autoRenewAccount).to.eq('0x0000000000000000000000000000000000000000');
            expect(expiryInfo.autoRenewPeriod).to.exist;
            expect(expiryInfo.autoRenewPeriod.toString()).to.eq('0');
            expect(expiryInfo.second).to.exist;
        });

        it("ETHCALL-037 - Function with HederaTokenService.getTokenKey(token, keyType)", async () => {
            const key = await htsImpl.callStatic.getTokenKeyPublic(tokenAddress, 0x000);
            expect(key).to.exist;

            console.log("=========KEY====");
            console.log(key);
            console.log("=============");

        });
    });

    xdescribe("others", async () => {
        it("ETHCALL-038 - Test allowance with evm address for spender", async () => {
        });

        it("ETHCALL-039 - Test allowance with evm address for owner", async () => {
        });

        it("ETHCALL-040 - Test allowance with evm address for owner and spender", async () => {
        });

        it("ETHCALL-041 - Test isApprovedForAll with evm address for owner", async () => {
        });

        it("ETHCALL-042 - Test isApprovedForAll with evm address for operator", async () => {
        });

        it("ETHCALL-043 - Test isApprovedForAll with evm address for owner and operator", async () => {
        });

        it("ETHCALL-044 - Test balanceOf with evm address for account", async () => {
        });

        it("ETHCALL-045 - Test isFrozen with evm address for account", async () => {
        });

        it("ETHCALL-046 - Test isKyc with evm address for account", async () => {
        });

        it("ETHCALL-047 - Test getTokenCustomFees with fixed fee set", async () => {
        });

        it("ETHCALL-048 - Test getTokenCustomFees with fractional fee set", async () => {
        });

        it("ETHCALL-049 - Test getTokenCustomFees with royalty fee set", async () => {
        });

        it("ETHCALL-050 - Test getTokenCustomFees with more than one fee set", async () => {
        });

        it("ETHCALL-051 - Test with non existing token from request body", async () => {
        });

        it("ETHCALL-052 - Test with non existing account from request body", async () => {
        });

        it("ETHCALL-053 - Test allowance with non existing owner or spender", async () => {
        });
    });
});
