import express from 'express';
import { paymentMiddleware, getPayment, STXtoMicroSTX, privateKeyToAccount, wrapAxiosWithPayment } from 'x402-stacks';
import { supabase } from '../config/supabase.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { updateMonetizedUrlForEndpoint } from '../utils/updateMonetizedUrls.js';
import axios from 'axios';

const router = express.Router();

/**
 * Dynamic proxy routing: /:username/:apiName/*
 * This handles all monetized API calls
 */
router.all('/:username/:apiName/*', async (req, res, next) => {
  try {
    const { username, apiName } = req.params;
    const endpointPath = (req.params as any)[0]; // The wildcard path after apiName

    // Resolve endpoint from database
    const { data: endpointData, error } = await supabase
      .from('endpoints')
      .select(`
        id,
        endpoint_path,
        original_url,
        price_microstx,
        active,
        apis!inner (
          id,
          api_name_slug,
          users!inner (
            username,
            wallet_address
          )
        )
      `)
      .eq('apis.users.username', username)
      .eq('apis.api_name_slug', apiName)
      .eq('endpoint_path', endpointPath)
      .eq('active', true)
      .single();

    if (error || !endpointData) {
      return res.status(404).json({
        success: false,
        error: 'Endpoint not found',
      });
    }

    const endpoint = endpointData as any;
    const developerWallet = endpoint.apis.users.wallet_address;

    // Update monetized URL if it doesn't exist (backend ensures URL is set)
    if (!endpoint.monetized_url) {
      await updateMonetizedUrlForEndpoint(endpoint.id);
    }

    // Attach endpoint config to request for payment middleware
    (req as any).endpointConfig = {
      id: endpoint.id,
      price_microstx: endpoint.price_microstx,
      developer_wallet: developerWallet,
      original_url: endpoint.original_url,
    };

    // Check if private key is provided (for direct payment without wallet connect)
    const privateKey = req.query.privateKey as string || req.headers['x-private-key'] as string;
    
    if (privateKey) {
      // Direct payment mode: use private key to auto-sign payment
      return handleDirectPayment(req, res, endpoint, privateKey);
    }

    // Normal mode: use payment middleware (requires wallet connect)
    const network = (process.env.NETWORK || 'testnet') as 'mainnet' | 'testnet';
    const facilitatorUrl = process.env.FACILITATOR_URL || 'https://facilitator.stacksx402.com';

    // Convert microSTX to STX for human-readable display
    const priceSTX = (parseInt(endpoint.price_microstx) / 1000000).toFixed(6).replace(/\.?0+$/, '');

    // Create payment middleware instance
    // Include description for better x402scan compatibility
    const paymentMw = paymentMiddleware({
      amount: endpoint.price_microstx.toString(),
      payTo: developerWallet,
      network: network,
      facilitatorUrl: facilitatorUrl,
      description: `${endpoint.endpoint_name || 'API endpoint'} - ${endpoint.apis?.api_name || 'ZedKr API'}`,
    });

    // Wrap the response to add human-readable STX amount to 402 responses
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      // If this is a 402 response, add amountSTX field to each accepts entry
      if (res.statusCode === 402 && body && body.accepts && Array.isArray(body.accepts)) {
        body.accepts = body.accepts.map((accept: any) => ({
          ...accept,
          amountSTX: priceSTX, // Add human-readable STX amount
        }));
      }
      return originalJson(body);
    };

    // Execute payment middleware, then proxy
    paymentMw(req, res, () => {
      // Payment verified - proceed to proxy
      handleProxiedRequest(req, res, endpoint);
    });
  } catch (error: any) {
    console.error('Proxy routing error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Handle direct payment with private key (auto-sign payment)
 * Uses wrapAxiosWithPayment to handle the full x402 flow automatically
 */
async function handleDirectPayment(req: express.Request, res: express.Response, endpoint: any, privateKey: string) {
  try {
    const network = (process.env.NETWORK || 'testnet') as 'mainnet' | 'testnet';
    const endpointConfig = (req as any).endpointConfig;

    // Create account from private key
    const account = privateKeyToAccount(privateKey, network);
    const payerAddress = account.address;

    // Use wrapAxiosWithPayment to handle x402 flow automatically
    const api = wrapAxiosWithPayment(
      axios.create({
        baseURL: process.env.ZEDKR_DOMAIN || 'https://zedkr.up.railway.app',
        timeout: 60000,
      }),
      account
    );

    // Build the request path (remove privateKey from query)
    const url = new URL(req.originalUrl, `http://${req.headers.host}`);
    url.searchParams.delete('privateKey'); // Remove private key from URL
    const requestPath = url.pathname + url.search;

    // Make the paid request - x402-stacks handles everything automatically
    const response = await api.get(requestPath);

    // Get payment details from response headers
    const paymentResponseHeader = response.headers['payment-response'];
    let payment: any = null;
    
    if (paymentResponseHeader) {
      try {
        const decoded = Buffer.from(paymentResponseHeader, 'base64').toString();
        const paymentData = JSON.parse(decoded);
        payment = {
          payer: paymentData.payer || payerAddress,
          transaction: paymentData.transaction || '',
          network: paymentData.network || network,
        };
      } catch (e) {
        // Fallback if decoding fails
        payment = {
          payer: payerAddress,
          transaction: '',
          network: network,
        };
      }
    } else {
      payment = {
        payer: payerAddress,
        transaction: '',
        network: network,
      };
    }

    // Attach payment to request for logging
    (req as any).payment = payment;

    // Send the response directly (it's already the proxied API response)
    // The x402-stacks library already handled the payment and got the API response
    res.status(response.status).json(response.data);
    
    // Log the API call
    if (payment && payment.transaction) {
      const startTime = Date.now();
      Promise.resolve(supabase.from('api_calls').insert({
        endpoint_id: endpointConfig.id,
        caller_wallet: payment.payer,
        tx_hash: payment.transaction,
        amount_paid: endpointConfig.price_microstx,
        status_code: response.status,
        latency_ms: Date.now() - startTime,
      })).then(() => {
        // Successfully logged
      }).catch((error: any) => {
        console.error('Error logging API call:', error);
      });
    }
  } catch (error: any) {
    console.error('Direct payment error:', error);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to process payment with private key: ' + error.message,
      });
    }
  }
}

/**
 * Handle proxied request after payment verification
 */
async function handleProxiedRequest(req: express.Request, res: express.Response, endpoint: any) {
  try {
    const payment = getPayment(req);
    const endpointConfig = (req as any).endpointConfig;

    // Log the API call
    if (payment) {
      await supabase.from('api_calls').insert({
        endpoint_id: endpointConfig.id,
        caller_wallet: payment.payer,
        tx_hash: payment.transaction,
        amount_paid: endpointConfig.price_microstx,
        status_code: null, // Will be updated after proxy
        latency_ms: null, // Will be updated after proxy
      });
    }

    // Create proxy middleware for this specific request
    const startTime = Date.now();
    const targetUrl = endpointConfig.original_url;

    // Parse target URL
    let targetUrlObj: URL;
    try {
      targetUrlObj = new URL(targetUrl);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid target URL',
      });
    }

    // Create proxy
    const proxy = createProxyMiddleware({
      target: `${targetUrlObj.protocol}//${targetUrlObj.host}`,
      changeOrigin: true,
      pathRewrite: {
        [`^/.*`]: targetUrlObj.pathname + (targetUrlObj.search || ''), // Use original path
      },
      onProxyReq: (proxyReq, req, res) => {
        // Forward original headers (except host and x402-specific headers)
        const headersToSkip = ['host', 'payment-signature', 'x-private-key'];
        Object.keys(req.headers).forEach((key) => {
          const lowerKey = key.toLowerCase();
          if (!headersToSkip.includes(lowerKey)) {
            const value = req.headers[key];
            if (value && typeof value === 'string') {
              proxyReq.setHeader(key, value);
            } else if (Array.isArray(value) && value.length > 0) {
              proxyReq.setHeader(key, value[0]);
            }
          }
        });

        // Forward body for POST/PUT/PATCH
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
      onProxyRes: async (proxyRes, req, res) => {
        const latency = Date.now() - startTime;

        // Add payment response header if payment was made
        // http-proxy-middleware already handles copying response headers, we just add our custom header
        if (payment && !res.headersSent) {
          try {
            const paymentResponse = {
              success: true,
              transaction: payment.transaction,
              payer: payment.payer,
              network: payment.network,
            };
            res.setHeader('payment-response', Buffer.from(JSON.stringify(paymentResponse)).toString('base64'));
          } catch (error) {
            // Headers already sent, ignore
            console.warn('Could not set payment-response header:', error);
          }
        }

        // Update API call log with status and latency (async, don't block response)
        if (payment) {
          // Don't await - run in background to avoid blocking response
          Promise.resolve(supabase
            .from('api_calls')
            .update({
              status_code: proxyRes.statusCode,
              latency_ms: latency,
            })
            .eq('tx_hash', payment.transaction)
          ).then(() => {
            // Successfully updated
          }).catch((error: any) => {
            console.error('Error updating API call log:', error);
          });
        }
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.status(502).json({
          success: false,
          error: 'Failed to proxy request to target API',
        });
      },
    });

    // Execute proxy
    proxy(req, res, () => {
      // Proxy completed
    });
  } catch (error: any) {
    console.error('Handle proxied request error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

export { router as proxyRouter };

