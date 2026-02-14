/**
 * Public API Routes
 * 
 * Routes that don't require authentication, including:
 * - Public stats
 * 
 * Note: STX price conversion is handled on frontend via CoinGecko API.
 * Backend has no knowledge of prices.
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/public/stats
 * Get public statistics about the platform
 */
router.get('/stats', async (req, res) => {
  try {
    // Return basic public stats
    res.json({
      success: true,
      data: {
        totalAPIs: 0, // Can be populated from database if needed
        totalCalls: 0,
        totalRevenue: 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching public stats:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
