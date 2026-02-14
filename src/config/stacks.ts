import * as StacksNetwork from '@stacks/network';
import 'dotenv/config';

const network = (process.env.NETWORK || 'testnet').toLowerCase();

// Use the constants that are available in the package
// Try STACKS_TESTNET/STACKS_MAINNET first, fallback to creating instances
export const stacksNetwork = network === 'mainnet' 
  ? (StacksNetwork.STACKS_MAINNET || new (StacksNetwork as any).StacksMainnet())
  : (StacksNetwork.STACKS_TESTNET || new (StacksNetwork as any).StacksTestnet());

export const isTestnet = network === 'testnet';

export const networkConfig = {
  network: network as 'testnet' | 'mainnet',
  stacksNetwork,
  isTestnet,
  apiUrl: network === 'mainnet' 
    ? 'https://api.hiro.so'
    : 'https://api.testnet.hiro.so',
  explorerUrl: isTestnet 
    ? 'https://explorer.stacks.co/?chain=testnet'
    : 'https://explorer.stacks.co',
};

