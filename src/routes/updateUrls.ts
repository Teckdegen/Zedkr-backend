/**
 * Background job to update monetized URLs for endpoints
 * This can be called periodically or on startup
 */

import express from 'express';
import { updateMonetizedUrls } from '../utils/updateMonetizedUrls.js';

const router = express.Router();

/**
 * Update monetized URLs for all endpoints that don't have them
 * POST /api/update-urls
 * 
 * This endpoint can be called:
 * - On server startup
 * - Periodically via cron job
 * - Manually when needed
 */
router.post('/', async (req, res) => {
  try {
    await updateMonetizedUrls();
    res.json({
      success: true,
      message: 'Monetized URLs updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating monetized URLs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update monetized URLs',
    });
  }
});

export default router;

