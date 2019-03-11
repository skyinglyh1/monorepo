import {
  Component,
  Element,
  Event,
  EventEmitter,
  Prop,
  State,
  Watch
} from "@stencil/core";

import AccountTunnel from "../../../../data/account";
import WalletTunnel from "../../../../data/wallet";
import { UserSession } from "../../../../types";

@Component({
  tag: "header-account",
  styleUrl: "header-account.scss",
  shadow: true
})
export class HeaderAccount {
  @Element() el!: HTMLStencilElement;
  @Prop() network: string = "";
  @Prop() error: { primary: string; secondary: string } = {
    primary: "",
    secondary: ""
  };
  @Prop() web3Detected: boolean = false;
  @Prop() hasDetectedNetwork: boolean = false;
  @Prop() metamaskUnlocked: boolean = false;
  @Prop() networkPermitted: boolean = false;
  @Prop({ mutable: true }) user: UserSession = {} as UserSession;
  @Prop({ mutable: true }) authenticated: boolean = false;
  @Prop() updateAccount: (e) => void = e => {};
  @Prop() login: () => Promise<UserSession> = async () => ({} as UserSession);
  @Prop() autoLogin: () => Promise<void> = async () => {};

  @Event() authenticationChanged: EventEmitter = {} as EventEmitter;

  @State() waitMultisigInterval: number = 0 as number;
  @State() metamaskConfirmationUIOpen: boolean = false;

  // TODO: This is a very weird way to prevent dual-execution of this lifecycle event.
  // But it works. See componentWillLoad() and componentDidUnload().
  static busy = false;

  @Watch("authenticated")
  authenticationChangedHandler() {
    this.authenticationChanged.emit({ authenticated: this.authenticated });
  }

  @Watch("user")
  userChangedHandler() {
    this.authenticated = !!(this.user && this.user.id);
  }

  async onLoginClicked() {
    this.removeError();

    this.metamaskConfirmationUIOpen = true;
    try {
      this.user = await this.login();
    } catch (error) {
      this.displayLoginError();
    } finally {
      this.metamaskConfirmationUIOpen = false;
    }
  }

  async onConnectMetamask() {
    this.metamaskConfirmationUIOpen = true;
    try {
      await window["ethereum"].enable();
    } catch {
      console.error("Was not able to call `window.ethereum.enable()`");
      window.alert(
        "Your browser does not support enabling your wallet programatically. Please unlock your Web3 wallet and try again."
      );
    } finally {
      this.metamaskConfirmationUIOpen = false;
    }
  }

  async componentWillLoad() {
    if (HeaderAccount.busy) {
      return;
    }

    await this.autoLogin();

    HeaderAccount.busy = true;
  }

  componentDidUnload() {
    HeaderAccount.busy = false;
  }

  displayLoginError() {
    this.updateAccount({
      error: {
        primary: "Login Failed",
        secondary: "You may not have a Playground account yet. Try registering."
      }
    });

    setTimeout(this.removeError.bind(this), 5000);
  }

  removeError() {
    this.updateAccount({
      error: null
    });
  }

  render() {
    if (!this.hasDetectedNetwork) {
      return;
    }

    if (!this.web3Detected) {
      return (
        <div class="account-container">
          <widget-error-message />
          <div class="message-container">No Ethereum Connection</div>
        </div>
      );
    }

    if (!this.networkPermitted) {
      return (
        <div class="account-container">
          <widget-error-message />
          <div class="message-container">Wrong Network</div>
        </div>
      );
    }

    if (!this.metamaskUnlocked) {
      return (
        <div class="account-container">
          <widget-error-message />
          <div class="btn-container">
            <button
              disabled={this.metamaskConfirmationUIOpen}
              onClick={this.onConnectMetamask.bind(this)}
              class="btn btn--connect-to-wallet"
            >
              <img class="icon" src="/assets/icon/wallet.svg" />
              {this.metamaskConfirmationUIOpen
                ? "Check Wallet..."
                : "Connect to Wallet"}
            </button>
          </div>
        </div>
      );
    }

    if (!this.authenticated) {
      return (
        <div class="account-container">
          <div class="btn-container">
            {this.error ? (
              <button
                onClick={this.onLoginClicked.bind(this)}
                class="btn btn-error"
              >
                <widget-tooltip message={this.error.secondary}>
                  <div class="widget-error-message">
                    <img class="icon" src="/assets/icon/error.svg" />
                    {this.error.primary}
                  </div>
                </widget-tooltip>
              </button>
            ) : (
              <button
                onClick={this.onLoginClicked.bind(this)}
                class="btn"
                disabled={this.metamaskConfirmationUIOpen}
              >
                <img class="icon" src="/assets/icon/login.svg" />
                {this.metamaskConfirmationUIOpen ? "Check Wallet..." : "Login"}
              </button>
            )}
            <stencil-route-link url="/register">
              <button class="btn btn-alternate">
                <img class="icon" src="/assets/icon/register.svg" />
                Register
              </button>
            </stencil-route-link>
          </div>
        </div>
      );
    }

    return (
      <div class="account-container">
        <div class="info-container">
          <header-balance />
          <stencil-route-link url="/account">
            <header-account-info
              src="/assets/icon/account.svg"
              header="Account"
              content={this.user.username}
            />
          </stencil-route-link>
        </div>
      </div>
    );
  }
}

AccountTunnel.injectProps(HeaderAccount, [
  "user",
  "error",
  "updateAccount",
  "login",
  "autoLogin"
]);

WalletTunnel.injectProps(HeaderAccount, [
  "network",
  "web3Detected",
  "networkPermitted",
  "metamaskUnlocked",
  "hasDetectedNetwork"
]);
