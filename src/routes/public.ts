import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * Get public stats for landing page
 * GET /api/public/stats
 */
router.get('/stats', async (req, res) => {
  try {
    // Get total network revenue (sum of all api_calls)
    const { data: totalRevenueData, error: revenueError } = await supabase
      .from('api_calls')
      .select('amount_paid');

    const totalRevenueMicroSTX = totalRevenueData?.reduce(
      (sum, call) => sum + Number(call.amount_paid || 0),
      0
    ) || 0;

    const totalRevenueSTX = totalRevenueMicroSTX / 1000000;

    // Get top 4 APIs by revenue
    const { data: topAPIsData, error: topAPIsError } = await supabase
      .from('apis')
      .select(`
        id,
        api_name,
        api_name_slug,
        users!inner (
          username
        ),
        endpoints (
          id,
          api_calls (
            amount_paid
          )
        )
      `)
      .eq('endpoints.active', true)
      .limit(100); // Get more to calculate revenue

    if (topAPIsError) {
      console.error('Error fetching top APIs:', topAPIsError);
    }

    // Calculate revenue for each API
    const apisWithRevenue = (topAPIsData || [])
      .map((api: any) => {
        const revenue = (api.endpoints || [])
          .flatMap((e: any) => e.api_calls || [])
          .reduce((sum: number, call: any) => sum + Number(call.amount_paid || 0), 0);

        const totalCalls = (api.endpoints || [])
          .flatMap((e: any) => e.api_calls || [])
          .length;

        return {
          id: api.id,
          name: api.api_name,
          username: api.users?.username || null,
          revenue: revenue / 1000000, // Convert to STX
          totalCalls,
        };
      })
      .filter((api: any) => api.revenue > 0) // Only APIs with revenue
      .sort((a: any, b: any) => b.revenue - a.revenue) // Sort by revenue descending
      .slice(0, 4) // Top 4
      .map((api: any) => ({
        id: api.id,
        name: api.name,
        username: api.username,
        revenue: api.revenue,
        revenueFormatted: `$${api.revenue.toFixed(2)}`,
        totalCalls: api.totalCalls,
      }));

    res.json({
      success: true,
      totalNetworkRevenue: totalRevenueSTX,
      totalNetworkRevenueFormatted: `$${totalRevenueSTX.toFixed(2)}`,
      topAPIs: apisWithRevenue,
    });
  } catch (error: any) {
    console.error('Get public stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;

