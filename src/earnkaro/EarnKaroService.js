'use strict';

/**
 * services/EarnKaroService.js
 *
 * Handles all interaction with the EarnKaro Developer API.
 *
 * Responsibilities:
 *  - Submit deal text containing original URLs
 *  - Parse converted affiliate links from the response
 *  - Retry on transient failures with exponential backoff
 *  - Validate conversion results
 *  - Log every stage of the conversion lifecycle
 */

const axios = require('axios');
const config = require('../config/env');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/asyncWrapper');

const log = logger.forModule('EarnKaroService');

class EarnKaroService {
  constructor() {
    this._client = axios.create({
      baseURL: config.earnkaro.apiUrl,
      timeout: config.earnkaro.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.earnkaro.apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // Attach request/response interceptors for logging
    this._attachInterceptors();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Converts a deal message by replacing all eligible links with EarnKaro
   * affiliate links.
   *
   * @param {string} dealText — the full deal message text (may contain multiple URLs)
   * @returns {Promise<{ convertedText: string; success: boolean; error?: string }>}
   */
  async convertDeal(dealText) {
    if (!dealText || typeof dealText !== 'string') {
      throw new TypeError('[EarnKaro] dealText must be a non-empty string');
    }

    log.info('Starting link conversion', {
      textLength: dealText.length,
      preview: dealText.slice(0, 80),
    });

    try {
      const response = await withRetry(
        () => this._callApi(dealText),
        {
          maxRetries: config.earnkaro.maxRetries,
          label: 'EarnKaro.convertDeal',
          shouldRetry: this._isRetryableError,
        },
      );

      const convertedText = this._extractConvertedText(response);

      log.info('Conversion successful', {
        originalLength: dealText.length,
        convertedLength: convertedText.length,
      });

      return { convertedText, success: true };
    } catch (err) {
      log.error('Conversion failed permanently', { error: err.message });
      return {
        convertedText: dealText, // fall back to original text
        success: false,
        error: err.message,
      };
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Makes the actual POST request to the EarnKaro API.
   * @param {string} dealText
   * @returns {Promise<object>} raw API response data
   */
  async _callApi(dealText) {
    const payload = {
      deal: dealText,
      convert_option: 'convert_only',
    };

    const { data } = await this._client.post('', payload);
    return data;
  }

  /**
   * Extracts the converted deal text from the EarnKaro API response.
   * EarnKaro returns the converted deal under `data.deal` or similar fields;
   * adjust this parsing if the API response shape changes.
   *
   * @param {object} responseData
   * @returns {string}
   */
  _extractConvertedText(responseData) {
    // Handle different possible response shapes
    if (typeof responseData === 'string') return responseData;

    // EarnKaro's actual response: { success: 1, data: "converted text", randomPostID: "..." }
    if (responseData?.success && responseData?.data != null) {
      if (typeof responseData.data === 'string') return responseData.data;
      if (typeof responseData.data === 'object' && responseData.data.deal) return responseData.data.deal;
    }

    if (responseData?.data?.deal) return responseData.data.deal;
    if (typeof responseData?.data === 'string') return responseData.data;
    if (responseData?.deal) return responseData.deal;
    if (responseData?.converted_deal) return responseData.converted_deal;
    if (responseData?.result) return responseData.result;

    log.warn('Unexpected API response shape; falling back to JSON stringify', {
      keys: Object.keys(responseData || {}),
    });

    // Last resort: return stringified (should not normally happen)
    return JSON.stringify(responseData);
  }

  /**
   * Determines whether a failed request should be retried.
   * @param {Error} err
   * @returns {boolean}
   */
  _isRetryableError(err) {
    if (!err.response) return true; // Network error → retry
    const { status } = err.response;
    // Retry on server errors and rate limits; not on client errors
    return status >= 500 || status === 429;
  }

  /**
   * Attaches Axios interceptors for structured logging.
   */
  _attachInterceptors() {
    this._client.interceptors.request.use((cfg) => {
      log.debug('API request', {
        url: cfg.url,
        bodyLength: JSON.stringify(cfg.data || {}).length,
      });
      return cfg;
    });

    this._client.interceptors.response.use(
      (res) => {
        log.debug('API response', { status: res.status });
        return res;
      },
      (err) => {
        log.error('API error response', {
          status: err.response?.status,
          data: err.response?.data,
          message: err.message,
        });
        return Promise.reject(err);
      },
    );
  }
}

// Export singleton
module.exports = new EarnKaroService();
