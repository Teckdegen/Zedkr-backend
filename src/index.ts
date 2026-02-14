import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler.js';
import { getNetworkInfo } from './utils/stacks.js';
import { updateMonetizedUrls } from './utils/updateMonetizedUrls.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/apis.js';
import publicRoutes from './routes/public.js';
import x402scanRoutes from './routes/x402scan.js';
import { proxyRouter } from './routes/proxy.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure testnet is default
if (!process.env.NETWORK) {
  process.env.NETWORK = 'testnet';
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://zedkr.com',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  const networkInfo = getNetworkInfo();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    network: networkInfo.network,
    isTestnet: networkInfo.isTestnet,
    apiUrl: networkInfo.apiUrl,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/apis', apiRoutes);
app.use('/api/public', publicRoutes);

// x402scan schema route (for endpoint discovery/registration)
// Must come before proxy router to handle /x402/* paths
app.use('/', x402scanRoutes);

// Dynamic proxy routing - MUST be last
app.use('/', proxyRouter);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, async () => {
  const networkInfo = getNetworkInfo();
  console.log(`🚀 ZedKr backend server running on port ${PORT}`);
  console.log(`📡 Network: ${networkInfo.network} (${networkInfo.isTestnet ? 'Testnet' : 'Mainnet'})`);
  console.log(`🔗 Stacks API: ${networkInfo.apiUrl}`);
  console.log(`💳 Facilitator: ${process.env.FACILITATOR_URL || 'https://facilitator.stacksx402.com'}`);
  
  // Update monetized URLs for endpoints that don't have them
  // This ensures all active endpoints have their monetized URLs set
  console.log('🔄 Updating monetized URLs for endpoints...');
  updateMonetizedUrls().then(() => {
    console.log('✅ Monetized URLs updated');
  }).catch((error) => {
    console.error('❌ Error updating monetized URLs:', error);
  });
});

export default app;

