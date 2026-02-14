import express from 'express';
import { supabase } from '../config/supabase.js';
import { verifyWalletAuth, AuthenticatedRequest } from '../middleware/walletAuth.js';
import { isValidStacksAddress, getNetworkInfo } from '../utils/stacks.js';

const router = express.Router();

/**
 * Register wallet address (auto-creates user if doesn't exist)
 * POST /api/auth/register-wallet
 */
router.post('/register-wallet', async (req, res) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required',
      });
    }

    // Validate Stacks address format using network config
    if (!isValidStacksAddress(wallet_address)) {
      const networkInfo = getNetworkInfo();
      return res.status(400).json({
        success: false,
        error: `Invalid Stacks wallet address format for ${networkInfo.network}. Expected ${networkInfo.isTestnet ? 'ST' : 'SP'} prefix.`,
      });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('wallet_address', wallet_address)
      .single();

    if (existingUser) {
      return res.json({
        success: true,
        user: existingUser,
        isNew: false,
      });
    }

    // Create new user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        wallet_address: wallet_address,
        username: null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user',
      });
    }

    res.json({
      success: true,
      user: newUser,
      isNew: true,
    });
  } catch (error: any) {
    console.error('Register wallet error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Set username for authenticated user
 * POST /api/auth/set-username
 */
router.post('/set-username', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { username } = req.body;
    const walletAddress = req.walletAddress!;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Username is required',
      });
    }

    // Validate username format (lowercase, alphanumeric, underscores)
    const usernameRegex = /^[a-z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Username can only contain lowercase letters, numbers, and underscores',
      });
    }

    // Check if username is already taken
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existingUser && existingUser.id !== req.user?.id) {
      return res.status(400).json({
        success: false,
        error: 'Username already taken',
      });
    }

    // Update user with username
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ username: username })
      .eq('wallet_address', walletAddress)
      .select()
      .single();

    if (error) {
      console.error('Error updating username:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update username',
      });
    }

    res.json({
      success: true,
      user: updatedUser,
    });
  } catch (error: any) {
    console.error('Set username error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Get current user info
 * GET /api/auth/me
 */
router.get('/me', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({
      success: true,
      user: req.user,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;

