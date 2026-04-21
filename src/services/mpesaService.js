const axios = require('axios');

// M-Pesa API Configuration
const MPESA_API_BASE = 'https://sandbox.safaricom.co.ke'; // Use sandbox for development
const MPESA_API_TIMEOUT = 30000; // 30 seconds

// Create axios instance for M-Pesa API calls
const mpesaClient = axios.create({
  baseURL: MPESA_API_BASE,
  timeout: MPESA_API_TIMEOUT
});

/**
 * Format phone number to M-Pesa 254 format
 * Accepts: 0712345678, 07xx, 01xx, +254xx, 254xx
 * Returns: 254712345678
 * @param {string} phone - Phone number in any Kenyan format
 * @returns {string} Formatted phone number (254xxxxxxxxx)
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return null;

  // Remove all non-digit characters (spaces, dashes, plus signs)
  let cleaned = phone.toString().replace(/\D/g, '');

  // Handle +254 prefix (already cleaned, but may start with 254)
  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return cleaned;
  }

  // Handle 0xxx format (Kenyan local)
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return '254' + cleaned.substring(1);
  }

  // Handle cases with country code but no leading 0 (e.g., 712345678)
  if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('1'))) {
    return '254' + cleaned;
  }

  // Already in correct format or unrecognized
  return cleaned;
};

/**
 * Validate that a phone number is a valid Kenyan M-Pesa number
 * @param {string} phone - Phone number (already formatted to 254xxx)
 * @returns {boolean}
 */
const isValidMpesaPhone = (phone) => {
  return /^254[17]\d{8}$/.test(phone);
};

/**
 * Get M-Pesa access token (OAuth 2.0)
 * @returns {Promise<string>} Access token
 */
const getAccessToken = async () => {
  try {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret || consumerKey === 'your_mpesa_consumer_key') {
      throw new Error('M-Pesa API credentials not configured. Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in .env');
    }

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await mpesaClient.get('/oauth/v1/generate', {
      headers: {
        Authorization: `Basic ${auth}`
      },
      params: {
        grant_type: 'client_credentials'
      }
    });

    console.log('✅ M-Pesa access token obtained successfully');
    return response.data.access_token;
  } catch (error) {
    console.error('❌ M-Pesa OAuth Error:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data));
    }
    throw new Error(`Failed to get M-Pesa access token: ${error.message}`);
  }
};

/**
 * Initiate STK push (Prompt) for M-Pesa payment
 * @param {string} phoneNumber - Customer phone number (any Kenyan format)
 * @param {number} amount - Amount in KES
 * @param {string} accountReference - Account reference/order ID
 * @param {string} transactionDesc - Transaction description
 * @returns {Promise<object>} STK push response
 */
const initiateStkPush = async (phoneNumber, amount, accountReference, transactionDesc = 'Service Payment') => {
  try {
    // Format phone number to 254xxx
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (!isValidMpesaPhone(formattedPhone)) {
      return {
        success: false,
        error: `Invalid phone number: ${phoneNumber} (formatted: ${formattedPhone}). Must be a valid Kenyan number.`,
        errorCode: 'INVALID_PHONE'
      };
    }

    const accessToken = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

    // Generate password for STK push
    const businessShortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const password = Buffer.from(
      `${businessShortCode}${passkey}${timestamp}`
    ).toString('base64');

    // Callback URL must be publicly accessible — uses /api/webhooks/ route
    const callbackURL = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/mpesa/callback`;

    console.log('📱 Initiating STK Push:');
    console.log('   Phone:', formattedPhone);
    console.log('   Amount:', amount);
    console.log('   Reference:', accountReference);
    console.log('   Callback URL:', callbackURL);

    const response = await mpesaClient.post('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount), // M-Pesa requires whole numbers
      PartyA: formattedPhone,
      PartyB: businessShortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackURL,
      AccountReference: accountReference.substring(0, 12), // Max 12 chars
      TransactionDesc: transactionDesc.substring(0, 13) // Max 13 chars
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ STK Push response:', JSON.stringify(response.data));

    return {
      success: true,
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription,
      customerMessage: response.data.CustomerMessage
    };
  } catch (error) {
    console.error('❌ M-Pesa STK Push Error:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', JSON.stringify(error.response.data));
    }
    return {
      success: false,
      error: error.response?.data?.errorMessage || error.message,
      errorCode: error.response?.data?.errorCode || 'UNKNOWN_ERROR'
    };
  }
};

/**
 * Query STK push status
 * @param {string} checkoutRequestId - Checkout request ID from STK push
 * @returns {Promise<object>} Query result
 */
const querySTKPushStatus = async (checkoutRequestId) => {
  try {
    const accessToken = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

    const businessShortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const password = Buffer.from(
      `${businessShortCode}${passkey}${timestamp}`
    ).toString('base64');

    const response = await mpesaClient.post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('🔍 STK Query response:', JSON.stringify(response.data));

    // ResultCode 0 = success, 1032 = cancelled, 1037 = timeout
    return {
      success: response.data.ResultCode === '0' || response.data.ResultCode === 0,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription,
      resultCode: response.data.ResultCode,
      resultDesc: response.data.ResultDesc
    };
  } catch (error) {
    console.error('❌ M-Pesa Query Error:', error.message);
    if (error.response) {
      console.error('   Response data:', JSON.stringify(error.response.data));
    }
    return {
      success: false,
      error: error.response?.data?.errorMessage || error.message,
      resultCode: error.response?.data?.ResultCode
    };
  }
};

/**
 * Process B2C payment (provider payout)
 * @param {string} phoneNumber - Recipient phone number
 * @param {number} amount - Amount to send
 * @param {string} commandId - Command type (e.g., 'BusinessPayment', 'SalaryPayment')
 * @param {string} remarks - Payment remarks
 * @returns {Promise<object>} B2C response
 */
const processB2CPayment = async (phoneNumber, amount, commandId = 'BusinessPayment', remarks = 'Service Provider Payout') => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const accessToken = await getAccessToken();

    const response = await mpesaClient.post('/mpesa/b2c/v3/paymentrequest', {
      OriginatorConversationID: `MVISA-${Date.now()}`,
      InitiatorName: process.env.MPESA_INITIATOR_NAME,
      InitiatorPassword: process.env.MPESA_INITIATOR_PASSWORD,
      CommandID: commandId,
      Amount: Math.round(amount),
      PartyA: process.env.MPESA_SHORTCODE,
      PartyB: formattedPhone,
      Remarks: remarks,
      QueueTimeOutURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/mpesa/timeout`,
      ResultURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/mpesa/b2c-callback`
    }, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      success: true,
      conversationId: response.data.ConversationID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription
    };
  } catch (error) {
    console.error('❌ M-Pesa B2C Error:', error.message);
    if (error.response) {
      console.error('   Response data:', JSON.stringify(error.response.data));
    }
    return {
      success: false,
      error: error.response?.data?.errorMessage || error.message,
      errorCode: error.response?.data?.errorCode || 'UNKNOWN_ERROR'
    };
  }
};

/**
 * Validate M-Pesa callback security with API validation
 * @param {string} transactionId - Transaction ID to validate
 * @returns {Promise<object>} Validation result
 */
const validateTransaction = async (transactionId) => {
  try {
    const accessToken = await getAccessToken();

    const response = await mpesaClient.get(`/mpesa/transactionstatus/v1/query/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return {
      success: response.data.ResponseCode === '0',
      transactionDetails: response.data
    };
  } catch (error) {
    console.error('❌ M-Pesa Validation Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  getAccessToken,
  formatPhoneNumber,
  isValidMpesaPhone,
  initiateStkPush,
  querySTKPushStatus,
  processB2CPayment,
  validateTransaction
};
