import { StacksTestnet, StacksMainnet } from '@stacks/network';
import 'dotenv/config';

const network = (process.env.NETWORK || 'testnet').toLowerCase();

export const stacksNetwork = network === 'mainnet' 
  ? new StacksMainnet() 
  : new StacksTestnet();

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

