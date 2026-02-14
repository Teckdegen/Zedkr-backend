import express from 'express';
import { paymentMiddleware, getPayment, STXtoMicroSTX } from 'x402-stacks';
import { supabase } from '../config/supabase.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { updateMonetizedUrlForEndpoint } from '../utils/updateMonetizedUrls.js';

const router = express.Router();

/**
 * Dynamic proxy routing: /:username/:apiName/*
 * This handles all monetized API calls
 */
router.all('/:username/:apiName/*', async (req, res, next) => {
  try {
    const { username, apiName } = req.params;
    const endpointPath = req.params[0]; // The wildcard path after apiName

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

    // Apply x402 payment middleware
    const network = (process.env.NETWORK || 'testnet') as 'mainnet' | 'testnet';
    const facilitatorUrl = process.env.FACILITATOR_URL || 'https://facilitator.stacksx402.com';

    // Create payment middleware instance
    // Include description for better x402scan compatibility
    const paymentMw = paymentMiddleware({
      amount: endpoint.price_microstx.toString(),
      payTo: developerWallet,
      network: network,
      facilitatorUrl: facilitatorUrl,
      description: `${endpoint.endpoint_name || 'API endpoint'} - ${endpoint.apis?.api_name || 'ZedKr API'}`,
    });

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
        // Forward original headers (except host)
        Object.keys(req.headers).forEach((key) => {
          if (key.toLowerCase() !== 'host') {
            const value = req.headers[key];
            if (value) {
              proxyReq.setHeader(key, value as string);
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

        // Update API call log with status and latency
        if (payment) {
          await supabase
            .from('api_calls')
            .update({
              status_code: proxyRes.statusCode,
              latency_ms: latency,
            })
            .eq('tx_hash', payment.transaction);
        }

        // Add payment response header if payment was made
        if (payment) {
          const paymentResponse = {
            success: true,
            transaction: payment.transaction,
            payer: payment.payer,
            network: payment.network,
          };
          res.setHeader('payment-response', Buffer.from(JSON.stringify(paymentResponse)).toString('base64'));
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

