import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { verifyMessageSignatureRsv } from '@stacks/transactions';
import { networkConfig } from '../config/stacks.js';

export interface AuthenticatedRequest extends Request {
  walletAddress?: string;
  user?: {
    id: string;
    username: string | null;
    wallet_address: string;
  };
}

/**
 * Middleware to verify wallet authentication
 * Expects:
 * - x-wallet-address header
 * - x-wallet-signature header (optional for now, can be added later)
 * - x-wallet-message header (optional for now)
 */
export const verifyWalletAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const walletAddress = req.headers['x-wallet-address'] as string;
    const signature = req.headers['x-wallet-signature'] as string;
    const message = req.headers['x-wallet-message'] as string;

    if (!walletAddress) {
      return res.status(401).json({
        success: false,
        error: 'Wallet address required. Include x-wallet-address header.',
      });
    }

    // Validate Stacks address format
    const isValidAddress = networkConfig.isTestnet
      ? walletAddress.startsWith('ST') // Testnet addresses start with ST
      : walletAddress.startsWith('SP'); // Mainnet addresses start with SP

    if (!isValidAddress) {
      return res.status(400).json({
        success: false,
        error: `Invalid Stacks wallet address format for ${networkConfig.network}. Expected ${networkConfig.isTestnet ? 'ST' : 'SP'} prefix.`,
      });
    }

    // Optional: Verify signature if provided
    if (signature && message) {
      try {
        const isValid = await verifyMessageSignatureRsv({
          message,
          signature,
          publicKey: walletAddress, // This needs to be derived from address
        });
        
        if (!isValid) {
          return res.status(401).json({
            success: false,
            error: 'Invalid wallet signature',
          });
        }
      } catch (sigError) {
        console.warn('Signature verification failed:', sigError);
        // For now, continue without signature verification
        // In production, you might want to require it
      }
    }

    // Find or create user by wallet address
    let { data: user, error } = await supabase
      .from('users')
      .select('id, username, wallet_address')
      .eq('wallet_address', walletAddress)
      .single();

    if (error && error.code === 'PGRST116') {
      // User doesn't exist - create them
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          wallet_address: walletAddress,
          username: null,
        })
        .select('id, username, wallet_address')
        .single();

      if (createError) {
        console.error('Error creating user:', createError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create user',
        });
      }

      user = newUser;
    } else if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({
        success: false,
        error: 'Database error',
      });
    }

    // Attach user to request
    req.walletAddress = walletAddress;
    req.user = user;

    next();
  } catch (error) {
    console.error('Wallet auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
    });
  }
};

