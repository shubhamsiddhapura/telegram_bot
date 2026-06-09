'use strict';

/**
 * helpers/telegramLoginHelper.js
 * 
 * Manages the step-by-step interactive login flow for Telegram
 * using GramJS. Exposes methods to send authentication codes
 * and verify them with support for 2FA passwords.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('../config/env');
const logger = require('../utils/logger');

const log = logger.forModule('TelegramLoginHelper');

class TelegramLoginHelper {
  constructor() {
    this._client = null;
    this._phoneNumber = null;
  }

  /**
   * Starts the GramJS client login process by sending a code to the user's phone.
   * @param {string} phoneNumber 
   * @returns {Promise<string>} The phoneCodeHash required for verification
   */
  async sendCode(phoneNumber) {
    log.info('Initiating Telegram login code request...', { phoneNumber });
    
    // Clean up any previous login attempt
    await this.cleanup();

    const session = new StringSession('');
    const apiId = config.telegram.apiId;
    const apiHash = config.telegram.apiHash;

    if (!apiId || !apiHash) {
      throw new Error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in server configuration');
    }

    try {
      this._client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        retryDelay: 1000,
      });

      await this._client.connect();
      this._phoneNumber = phoneNumber;

      const result = await this._client.sendCode(
        {
          apiId,
          apiHash,
        },
        phoneNumber
      );

      log.info('Verification code successfully requested from Telegram');
      return result.phoneCodeHash;
    } catch (err) {
      log.error('Failed to request verification code from Telegram', { error: err.message });
      await this.cleanup();
      throw err;
    }
  }

  /**
   * Submits the verification code and handles potential 2FA password requests.
   * @param {string} phoneCode 
   * @param {string} phoneCodeHash 
   * @param {string} [password] 
   * @returns {Promise<{ success: boolean, sessionString?: string, needsPassword?: boolean }>}
   */
  async verifyCode(phoneCode, phoneCodeHash, password = null) {
    if (!this._client) {
      log.error('VerifyCode called without active Telegram login client');
      throw new Error('No active login session found. Please send a verification code first.');
    }

    try {
      log.info('Submitting verification code to Telegram...');
      
      let signInOptions = {
        phoneNumber: this._phoneNumber,
        phoneCodeHash,
        phoneCode,
      };

      if (password) {
        signInOptions.password = async () => password;
      }

      await this._client.signIn(signInOptions);

      // Successfully signed in! Save the session
      const sessionString = this._client.session.save();
      log.info('Successfully logged in to Telegram! Generated StringSession.');

      // Disconnect the temporary client
      await this.cleanup();

      return {
        success: true,
        sessionString,
      };
    } catch (err) {
      // Check if 2FA password is required
      if (
        err.message?.includes('SESSION_PASSWORD_NEEDED') || 
        err.className === 'SessionPasswordNeededError'
      ) {
        log.info('Telegram requires 2FA password to complete login');
        return {
          success: false,
          needsPassword: true,
        };
      }

      log.error('Telegram verification/sign-in failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Cleans up and disconnects any temporary client.
   */
  async cleanup() {
    if (this._client) {
      try {
        await this._client.disconnect();
        log.debug('Disconnected temporary login client');
      } catch (err) {
        log.warn('Error during temporary client disconnect', { error: err.message });
      }
      this._client = null;
    }
    this._phoneNumber = null;
  }
}

module.exports = new TelegramLoginHelper();
