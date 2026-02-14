/**
 * x402scan Registration Route
 * 
 * This route returns x402 schema for endpoints to enable x402scan registration.
 * x402scan requires endpoints to return a valid x402 schema with outputSchema.
 * 
 * Format: GET /x402/:username/:apiName/:endpointPath
 * Returns: x402 v2 schema with outputSchema for x402scan discovery
 */

import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * Get x402 schema for an endpoint (for x402scan registration)
 * 
 * x402scan will fetch this URL to get the schema and register the endpoint.
 * This endpoint should return HTTP 402 with proper schema including outputSchema.
 */
router.get('/x402/:username/:apiName/:endpointPath', async (req, res) => {
  try {
    const { username, apiName, endpointPath } = req.params;
    const network = (process.env.NETWORK || 'testnet') as 'mainnet' | 'testnet';
    const zedkrDomain = process.env.ZEDKR_DOMAIN || 'https://zedkr.up.railway.app';

    // Resolve endpoint from database
    const { data: endpointData, error } = await supabase
      .from('endpoints')
      .select(`
        id,
        endpoint_name,
        endpoint_path,
        original_url,
        price_microstx,
        active,
        apis!inner (
          id,
          api_name,
          api_name_slug,
          image_url,
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
    // Ensure HTTPS URL (x402scan requires secure URLs)
    // Remove any protocol and force HTTPS
    const cleanDomain = zedkrDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const monetizedUrl = `https://${cleanDomain}/${username}/${apiName}/${endpointPath}`;

    // Convert network to CAIP-2 format for x402 v2
    const networkCAIP2 = network === 'mainnet' ? 'stacks:1' : 'stacks:2147483648';

    // Build x402 v2 schema for x402scan
    // x402scan requires: name, accepts array with network="stacks", and outputSchema
    const x402Schema: any = {
      x402Version: 2,
      name: `${endpoint.apis.api_name} - ${endpoint.endpoint_name}`,
      resource: {
        url: monetizedUrl,
        description: `${endpoint.endpoint_name} endpoint from ${endpoint.apis.api_name}`,
      },
    };

    // Add image if available (for x402scan registration)
    if (endpoint.apis.image_url) {
      x402Schema.image = endpoint.apis.image_url;
    }

    // Convert microSTX to STX for human-readable display
    const priceSTX = (parseInt(endpoint.price_microstx) / 1000000).toFixed(6).replace(/\.?0+$/, '');

    // Add accepts array with x402 v2 format
    x402Schema.accepts = [
      {
        scheme: 'exact',
        network: networkCAIP2,
        amount: endpoint.price_microstx.toString(), // Protocol requires microSTX
        amountSTX: priceSTX, // Human-readable STX amount
        asset: 'STX',
        payTo: developerWallet,
        maxTimeoutSeconds: 300,
        resource: monetizedUrl,
        description: endpoint.endpoint_name,
        mimeType: 'application/json',
        // outputSchema is REQUIRED for x402scan registration
        outputSchema: {
          input: {
            type: 'request',
            method: req.method || 'GET',
            description: `Call ${endpoint.endpoint_name} endpoint`,
          },
          output: {
            type: 'object',
            description: 'Response from the proxied API endpoint',
            // We can't know the exact output schema without calling the original API
            // So we provide a generic structure
            properties: {
              data: {
                type: 'any',
                description: 'Response data from the original API',
              },
              success: {
                type: 'boolean',
                description: 'Whether the request was successful',
              },
            },
          },
        },
      },
    ];

    // Return 402 Payment Required with schema (x402scan expects this)
    res.status(402).json(x402Schema);
  } catch (error: any) {
    console.error('x402scan schema error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

