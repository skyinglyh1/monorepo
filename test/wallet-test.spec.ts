import * as ethers from "ethers";
import { AppChannelClient } from "../cf.js/app-channel-client";
import { ClientInterface } from "../cf.js/client-interface";
import { CfAppInterface, Terms } from "../src/middleware/cf-operation/types";
import {
  ClientActionMessage,
  InstallOptions,
  WalletMessaging
} from "../src/types";
import { sleep } from "./common";
import {
  A_ADDRESS,
  A_PRIVATE_KEY,
  B_ADDRESS,
  B_PRIVATE_KEY,
  MULTISIG_ADDRESS,
  MULTISIG_PRIVATE_KEY
} from "./environment";
import { TestWallet } from "./wallet/wallet";

const PAYMENT_APP_STATE_ENCODING =
  "tuple(address alice, address bob, uint256 aliceBalance, uint256 bobBalance)";
const PAYMENT_APP_ABI_ENCODING =
  "resolve(tuple(address,address,uint256,uint256),tuple(uint8,uint256,address))";
const INSTALL_OPTIONS: InstallOptions = {
  peerABalance: ethers.utils.bigNumberify(0),
  peerBBalance: ethers.utils.bigNumberify(0),
  abiEncoding: PAYMENT_APP_ABI_ENCODING,
  stateEncoding: PAYMENT_APP_STATE_ENCODING,
  state: {
    alice: A_ADDRESS,
    bob: B_ADDRESS,
    aliceBalance: ethers.utils.bigNumberify(10),
    bobBalance: ethers.utils.bigNumberify(10)
  }
};

const blockchainProvider = new ethers.providers.JsonRpcProvider(
  process.env.GANACHE_URL
);

class ClientWalletBridge implements WalletMessaging {
  public wallet: TestWallet;

  constructor(wallet: TestWallet) {
    this.wallet = wallet;
  }

  public postMessage(message: ClientActionMessage, to: string) {
    // TODO move this into a setTimeout to enfore asyncness of the call
    this.wallet.receiveMessageFromClient(message);
  }

  public onMessage(userId: string, callback: Function) {
    this.wallet.onResponse(callback);
  }
}

let multisigContractAddress;

describe("Lifecycle", async () => {
  // extending the timeout to allow the async machines to finish
  jest.setTimeout(30000);

  let multisigContract;
  const owners = [A_ADDRESS, B_ADDRESS];
  beforeAll(async () => {
    const multisigWallet = new TestWallet();
    multisigWallet.setUser(MULTISIG_ADDRESS, MULTISIG_PRIVATE_KEY);

    multisigContract = await ClientInterface.deployMultisig(
      multisigWallet.currentUser.ethersWallet,
      owners,
      multisigWallet.network
    );
    expect(multisigContract.address).not.toBe(null);
    expect(await multisigContract.functions.getOwners()).toEqual(owners);
    multisigContractAddress = multisigContract.address;
  });

  let walletA;
  let walletB;
  let connectionA;
  let connectionB;
  let clientA;
  let clientB;
  beforeEach(async () => {
    walletA = new TestWallet();
    walletB = new TestWallet();
    walletA.setUser(A_ADDRESS, A_PRIVATE_KEY);
    walletB.setUser(B_ADDRESS, B_PRIVATE_KEY);
    connectionA = new ClientWalletBridge(walletA);
    connectionB = new ClientWalletBridge(walletB);
    clientA = new ClientInterface("some-user-id", connectionA);
    clientB = new ClientInterface("some-user-id", connectionB);
    await clientA.init();
    await clientB.init();

    walletA.currentUser.io.peer = walletB;
    walletB.currentUser.io.peer = walletA;
  });

  it("Can observe an installation of an app", async () => {
    // hasAssertions to ensure that the "installCompleted" observer fires
    expect.hasAssertions();

    const stateChannelA = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    await clientB.getOrCreateStateChannel(A_ADDRESS, multisigContractAddress);
    clientB.addObserver("installCompleted", data => {
      expect(true).toBeTruthy();
    });
    await stateChannelA.install("paymentApp", INSTALL_OPTIONS);

    await sleep(50);
  });

  it("Can remove observers", async () => {
    // hasAssertions to ensure that the "installCompleted" observer fires
    expect.hasAssertions();

    const stateChannelA = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    await clientB.getOrCreateStateChannel(A_ADDRESS, multisigContractAddress);
    const falsyCallback = () => expect(false).toBeTruthy();
    clientB.addObserver("installCompleted", data => {
      expect(true).toBeTruthy();
    });
    clientB.addObserver("installCompleted", falsyCallback);
    clientB.removeObserver("installCompleted", falsyCallback);
    await stateChannelA.install("paymentApp", INSTALL_OPTIONS);

    await sleep(50);
  });

  it("Will notify only the current user", async () => {
    // hasAssertions to ensure that the "installCompleted" observer fires
    expect.hasAssertions();

    const walletA = new TestWallet();
    const walletB = new TestWallet();
    walletA.setUser(A_ADDRESS, A_PRIVATE_KEY);
    walletB.setUser(B_ADDRESS, B_PRIVATE_KEY);
    const connectionA = new ClientWalletBridge(walletA);
    const connectionB = new ClientWalletBridge(walletB);
    const clientA = new ClientInterface("some-user-id", connectionA);
    const clientB = new ClientInterface("some-user-id", connectionB);

    clientB.addObserver("installCompleted", data => {
      expect(false).toBeTruthy();
    });

    walletB.setUser(B_ADDRESS, B_PRIVATE_KEY);

    await clientA.init();
    await clientB.init();

    walletA.currentUser.io.peer = walletB;
    walletB.currentUser.io.peer = walletA;

    const stateChannelAB = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    await clientB.getOrCreateStateChannel(multisigContractAddress, A_ADDRESS);

    clientB.addObserver("installCompleted", data => {
      expect(true).toBeTruthy();
    });

    await stateChannelAB.install("paymentApp", INSTALL_OPTIONS);

    await sleep(50);
  });

  it("Can deposit to a state channel", async () => {
    const amountA = ethers.utils.parseEther("5");
    const amountB = ethers.utils.parseEther("7");

    const stateChannelAB = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    const stateChannelBA = clientB.getOrCreateStateChannel(
      stateChannelAB.multisigAddress,
      A_ADDRESS
    );

    await stateChannelAB.deposit(amountA, ethers.utils.bigNumberify(0));
    await validateDeposit(
      walletA,
      walletB,
      amountA,
      ethers.utils.bigNumberify(0)
    );
    await stateChannelBA.deposit(amountB, amountA);
    await validateDeposit(walletA, walletB, amountA, amountB);
  });

  it("Can install an app", async () => {
    const connection = new ClientWalletBridge(walletA);
    const client = new ClientInterface("some-user-id", connection);
    await client.init();
    walletA.currentUser.io.peer = walletB;
    walletB.currentUser.io.peer = walletA;
    const threshold = 10;

    const stateChannel = await client.setup(B_ADDRESS, multisigContractAddress);
    await stateChannel.install("paymentApp", INSTALL_OPTIONS);

    await sleep(50);
    // check B's client
    validateInstalledBalanceRefund(walletB, threshold);
    // check A's client and return the newly created cf address
    validateInstalledBalanceRefund(walletA, threshold);
  });

  it("Can uninstall an app", async () => {
    const connection = new ClientWalletBridge(walletA);
    const client = new ClientInterface("some-user-id", connection);
    await client.init();

    const stateChannel = await client.setup(B_ADDRESS, multisigContractAddress);
    const appChannel = await stateChannel.install(
      "paymentApp",
      INSTALL_OPTIONS
    );

    const uninstallAmountA = ethers.utils.bigNumberify(10);
    const uninstallAmountB = ethers.utils.bigNumberify(0);

    await appChannel.uninstall({
      peerABalance: uninstallAmountA,
      peerBBalance: uninstallAmountB
    });

    // validate walletA
    validateNoAppsAndFreeBalance(
      walletA,
      walletB,
      uninstallAmountA,
      uninstallAmountB
    );
    // validate walletB
    validateNoAppsAndFreeBalance(
      walletB,
      walletA,
      uninstallAmountB,
      uninstallAmountA
    );
  });

  it("Can update an app", async () => {
    const connection = new ClientWalletBridge(walletA);
    const client = new ClientInterface("some-user-id", connection);
    await client.init();

    const stateChannel = await client.setup(B_ADDRESS, multisigContractAddress);
    const appChannel = await stateChannel.install(
      "paymentApp",
      INSTALL_OPTIONS
    );

    await makePayments(walletA, walletB, appChannel);
  });

  it("Can change users", async () => {
    const connection = new ClientWalletBridge(walletA);
    const client = new ClientInterface("some-user-id", connection);
    await client.init();

    const threshold = 10;

    const stateChannel = await client.setup(B_ADDRESS, multisigContractAddress);
    await stateChannel.install("paymentApp", INSTALL_OPTIONS);

    await sleep(50);

    validateInstalledBalanceRefund(walletA, threshold);

    const C_ADDRESS = "0xB37ABb9F5CCc5Ce5f2694CE0720216B786cad61D";
    walletA.setUser(C_ADDRESS, A_PRIVATE_KEY);

    const state = walletA.currentUser.vm.cfState;
    expect(Object.keys(state.channelStates).length).toBe(0);

    walletA.setUser(A_ADDRESS, A_PRIVATE_KEY);

    validateInstalledBalanceRefund(walletA, threshold);
  });

  it("Can query freeBalance", async () => {
    const connection = new ClientWalletBridge(walletA);
    const client = new ClientInterface("some-user-id", connection);
    await client.init();

    const stateChannel = await client.setup(B_ADDRESS, multisigContractAddress);
    await stateChannel.install("paymentApp", INSTALL_OPTIONS);
    const freeBalance = await stateChannel.queryFreeBalance();

    expect(freeBalance.data.freeBalance.aliceBalance.toNumber()).toBe(0);
    expect(freeBalance.data.freeBalance.bobBalance.toNumber()).toBe(0);
  });

  it("Can query stateChannel", async () => {
    const connection = new ClientWalletBridge(walletA);
    const clientA = new ClientInterface("some-user-id", connection);
    await clientA.init();

    const stateChannelAB = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    await stateChannelAB.install("paymentApp", INSTALL_OPTIONS);
    const stateChannelInfo = await stateChannelAB.queryStateChannel();

    expect(stateChannelInfo.data.stateChannel.counterParty).toBe(
      stateChannelAB.toAddress
    );
    expect(stateChannelInfo.data.stateChannel.me).toBe(
      stateChannelAB.fromAddress
    );
    expect(stateChannelInfo.data.stateChannel.multisigAddress).toBe(
      multisigContractAddress
    );
  });

  it("Allows apps to communicate directly with each other", async () => {
    const connectionA = new ClientWalletBridge(walletA);
    const clientA = new ClientInterface("some-user-id", connectionA);
    walletA.onMessage(msg => {
      clientA.sendIOMessage(msg);
    });
    walletB.onMessage(msg => {
      clientB.sendIOMessage(msg);
    });

    clientA.registerIOSendMessage(msg => {
      clientB.receiveIOMessage(msg);
    });
    clientB.registerIOSendMessage(msg => {
      clientA.receiveIOMessage(msg);
    });

    await clientA.init();
    await clientB.init();

    const stateChannel = await clientA.setup(
      B_ADDRESS,
      multisigContractAddress
    );
    await stateChannel.install("paymentApp", INSTALL_OPTIONS);

    const threshold = 10;

    await sleep(50);

    validateInstalledBalanceRefund(walletB, threshold);
    validateInstalledBalanceRefund(walletA, threshold);
  });
});

/**
 * Validates the correctness of walletA's free balance *not* walletB's.
 */
function validateNoAppsAndFreeBalance(
  walletA: TestWallet,
  walletB: TestWallet,
  amountA: ethers.BigNumber,
  amountB: ethers.BigNumber
) {
  // todo: add nonce and uniqueId params and check them
  const state = walletA.currentUser.vm.cfState;

  let peerA = walletA.address;
  let peerB = walletB.address;
  if (peerB!.localeCompare(peerA!) < 0) {
    const tmp = peerA;
    peerA = peerB;
    peerB = tmp;
    const tmpAmount = amountA;
    amountA = amountB;
    amountB = tmpAmount;
  }

  const channel =
    walletA.currentUser.vm.cfState.channelStates[multisigContractAddress];
  expect(Object.keys(state.channelStates).length).toBe(1);
  expect(channel.counterParty).toBe(walletB.address);
  expect(channel.me).toBe(walletA.address);
  expect(channel.multisigAddress).toBe(multisigContractAddress);
  expect(channel.freeBalance.alice).toBe(peerA);
  expect(channel.freeBalance.bob).toBe(peerB);
  expect(channel.freeBalance.aliceBalance.toNumber()).toBe(amountA.toNumber());
  expect(channel.freeBalance.bobBalance.toNumber()).toBe(amountB.toNumber());

  Object.keys(channel.appChannels).forEach(appId => {
    expect(channel.appChannels[appId].dependencyNonce.nonceValue).toBe(2);
  });
}

function validateInstalledBalanceRefund(wallet: TestWallet, amount: number) {
  const stateChannel =
    wallet.currentUser.vm.cfState.channelStates[multisigContractAddress];
  const appChannels = stateChannel.appChannels;
  const cfAddrs = Object.keys(appChannels);
  expect(cfAddrs.length).toBe(1);

  const cfAddr = cfAddrs[0];

  expect(appChannels[cfAddr].peerA.balance.toNumber()).toBe(0);
  expect(appChannels[cfAddr].peerA.address).toBe(
    stateChannel.freeBalance.alice
  );
  expect(appChannels[cfAddr].peerA.balance.toNumber()).toBe(0);

  expect(appChannels[cfAddr].peerB.balance.toNumber()).toBe(0);
  expect(appChannels[cfAddr].peerB.address).toBe(stateChannel.freeBalance.bob);
  expect(appChannels[cfAddr].peerB.balance.toNumber()).toBe(0);

  return cfAddr;
}

async function validateDeposit(
  walletA: TestWallet,
  walletB: TestWallet,
  amountA: ethers.BigNumber,
  amountB: ethers.BigNumber
) {
  await validateMultisigBalance(amountA, amountB);
  validateFreebalance(walletB, amountA, amountB);
  validateFreebalance(walletA, amountA, amountB);
}

async function validateMultisigBalance(
  aliceBalance: ethers.BigNumber,
  bobBalance: ethers.BigNumber
) {
  const multisigAmount = await blockchainProvider.getBalance(
    multisigContractAddress
  );
  expect(ethers.utils.bigNumberify(multisigAmount).toString()).toBe(
    aliceBalance.add(bobBalance).toString()
  );
}

function validateFreebalance(
  wallet: TestWallet,
  aliceBalance: ethers.BigNumber,
  bobBalance: ethers.BigNumber
) {
  const stateChannel =
    wallet.currentUser.vm.cfState.channelStates[multisigContractAddress];
  const freeBalance = stateChannel.freeBalance;

  expect(freeBalance.aliceBalance.toString()).toBe(aliceBalance.toString());
  expect(freeBalance.bobBalance.toString()).toBe(bobBalance.toString());
}

async function makePayments(
  walletA: TestWallet,
  walletB: TestWallet,
  appChannel: AppChannelClient
) {
  await makePayment(walletA, walletB, appChannel, "5", "15", 1);
  await makePayment(walletA, walletB, appChannel, "7", "12", 2);
  await makePayment(walletA, walletB, appChannel, "13", "6", 3);
  await makePayment(walletA, walletB, appChannel, "17", "2", 4);
  await makePayment(walletA, walletB, appChannel, "12", "8", 5);
}

async function makePayment(
  walletA: TestWallet,
  walletB: TestWallet,
  appChannel: AppChannelClient,
  aliceBalance: string,
  bobBalance: string,
  totalUpdates: number
) {
  const newState = {
    ...INSTALL_OPTIONS.state,
    aliceBalance: ethers.utils.bigNumberify(aliceBalance),
    bobBalance: ethers.utils.bigNumberify(bobBalance)
  };

  await appChannel.update({ state: newState });
  validateUpdatePayment(walletA, walletB, appChannel, newState, totalUpdates);
}

function validateUpdatePayment(
  walletA: TestWallet,
  walletB: TestWallet,
  appChannel: AppChannelClient,
  appState: object,
  totalUpdates: number
) {
  const appA =
    walletA.currentUser.vm.cfState.channelStates[multisigContractAddress]
      .appChannels[appChannel.appId];
  const appB =
    walletB.currentUser.vm.cfState.channelStates[multisigContractAddress]
      .appChannels[appChannel.appId];

  const encodedAppState = appChannel.appInterface.encode(appState);
  const appStateHash = appChannel.appInterface.stateHash(appState);

  expect(appA.encodedState).toBe(encodedAppState);
  expect(appA.appStateHash).toBe(appStateHash);
  expect(appA.localNonce).toBe(totalUpdates + 1);
  expect(appB.encodedState).toBe(encodedAppState);
  expect(appB.appStateHash).toBe(appStateHash);
  expect(appB.localNonce).toBe(totalUpdates + 1);
}
