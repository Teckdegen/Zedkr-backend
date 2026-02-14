import express from 'express';
import { supabase } from '../config/supabase.js';
import { verifyWalletAuth, AuthenticatedRequest } from '../middleware/walletAuth.js';

const router = express.Router();

/**
 * Get user's APIs
 * GET /api/apis/my
 */
router.get('/my', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get user's APIs with endpoints
    const { data: apis, error } = await supabase
      .from('apis')
      .select(`
        *,
        endpoints (
          id,
          endpoint_name,
          endpoint_path,
          original_url,
          price_microstx,
          active
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching APIs:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch APIs',
      });
    }

    // Calculate stats for each API
    const apisWithStats = await Promise.all(
      (apis || []).map(async (api) => {
        // Get call stats
        const { data: calls } = await supabase
          .from('api_calls')
          .select('amount_paid')
          .in('endpoint_id', (api.endpoints || []).map((e: any) => e.id));

        const totalCalls = calls?.length || 0;
        const revenue = calls?.reduce((sum, call) => sum + Number(call.amount_paid || 0), 0) || 0;
        const revenueSTX = revenue / 1000000; // Convert microSTX to STX

        return {
          id: api.id,
          name: api.api_name,
          apiNameSlug: api.api_name_slug,
          status: 'active' as const,
          revenue: revenueSTX,
          totalCalls,
          endpoints: (api.endpoints || []).map((e: any) => ({
            id: e.id,
            name: e.endpoint_name,
            path: e.endpoint_path,
            price: e.price_microstx / 1000000, // Convert to STX
            calls: 0, // TODO: Calculate per endpoint
            revenue: 0, // TODO: Calculate per endpoint
          })),
        };
      })
    );

    res.json({
      success: true,
      apis: apisWithStats,
    });
  } catch (error: any) {
    console.error('Get APIs error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Create new API
 * POST /api/apis
 */
router.post('/', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { apiName, apiNameSlug, endpoints } = req.body;
    const userId = req.user!.id;

    if (!apiName || !apiNameSlug) {
      return res.status(400).json({
        success: false,
        error: 'API name and slug are required',
      });
    }

    // Validate API name slug format
    const slugRegex = /^[a-z0-9_-]+$/;
    if (!slugRegex.test(apiNameSlug)) {
      return res.status(400).json({
        success: false,
        error: 'API name slug can only contain lowercase letters, numbers, hyphens, and underscores',
      });
    }

    // Check if API name slug already exists for this user
    const { data: existingApi } = await supabase
      .from('apis')
      .select('id')
      .eq('user_id', userId)
      .eq('api_name_slug', apiNameSlug)
      .single();

    if (existingApi) {
      return res.status(400).json({
        success: false,
        error: 'API name already exists',
      });
    }

    // Create API
    const { data: api, error: apiError } = await supabase
      .from('apis')
      .insert({
        user_id: userId,
        api_name: apiName,
        api_name_slug: apiNameSlug,
      })
      .select()
      .single();

    if (apiError) {
      console.error('Error creating API:', apiError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create API',
      });
    }

    // Create endpoints if provided
    if (endpoints && Array.isArray(endpoints) && endpoints.length > 0) {
      const endpointsData = endpoints.map((e: any) => ({
        api_id: api.id,
        endpoint_name: e.endpointName || '',
        endpoint_path: e.endpointPath || '',
        original_url: e.originalUrl || '',
        price_microstx: Math.round((parseFloat(e.price) || 0) * 1000000), // Convert STX to microSTX
        active: true,
      }));

      // Validate endpoint paths
      const pathRegex = /^[a-z0-9_-]+$/;
      for (const endpoint of endpointsData) {
        if (!pathRegex.test(endpoint.endpoint_path)) {
          return res.status(400).json({
            success: false,
            error: `Invalid endpoint path: ${endpoint.endpoint_path}. Only lowercase letters, numbers, hyphens, and underscores allowed.`,
          });
        }
      }

      const { error: endpointsError } = await supabase
        .from('endpoints')
        .insert(endpointsData);

      if (endpointsError) {
        console.error('Error creating endpoints:', endpointsError);
        // Rollback API creation
        await supabase.from('apis').delete().eq('id', api.id);
        return res.status(500).json({
          success: false,
          error: 'Failed to create endpoints',
        });
      }
    }

    res.json({
      success: true,
      api,
    });
  } catch (error: any) {
    console.error('Create API error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Update API
 * PUT /api/apis/:id
 */
router.put('/:id', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { apiName, endpoints } = req.body;
    const userId = req.user!.id;

    // Verify API belongs to user
    const { data: api, error: apiError } = await supabase
      .from('apis')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (apiError || !api) {
      return res.status(404).json({
        success: false,
        error: 'API not found',
      });
    }

    // Update API name if provided
    if (apiName) {
      const { error: updateError } = await supabase
        .from('apis')
        .update({ api_name: apiName })
        .eq('id', id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          error: 'Failed to update API',
        });
      }
    }

    // Update endpoints if provided
    if (endpoints && Array.isArray(endpoints)) {
      // Delete existing endpoints
      await supabase.from('endpoints').delete().eq('api_id', id);

      // Create new endpoints
      if (endpoints.length > 0) {
        const endpointsData = endpoints.map((e: any) => ({
          api_id: id,
          endpoint_name: e.endpointName || e.name || '',
          endpoint_path: e.endpointPath || e.path || '',
          original_url: e.originalUrl || e.original_url || '',
          price_microstx: Math.round((parseFloat(e.price) || 0) * 1000000),
          active: true,
        }));

        const { error: endpointsError } = await supabase
          .from('endpoints')
          .insert(endpointsData);

        if (endpointsError) {
          return res.status(500).json({
            success: false,
            error: 'Failed to update endpoints',
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'API updated successfully',
    });
  } catch (error: any) {
    console.error('Update API error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Delete API
 * DELETE /api/apis/:id
 */
router.delete('/:id', verifyWalletAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Verify API belongs to user
    const { data: api } = await supabase
      .from('apis')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found',
      });
    }

    // Delete API (endpoints will be cascade deleted)
    const { error } = await supabase
      .from('apis')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Failed to delete API',
      });
    }

    res.json({
      success: true,
      message: 'API deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete API error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;

