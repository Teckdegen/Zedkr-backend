import { networkConfig } from '../config/stacks.js';
import { StacksTestnet, StacksMainnet } from '@stacks/network';

/**
 * Validate Stacks address format
 */
export function isValidStacksAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Testnet addresses start with ST, mainnet with SP
  const expectedPrefix = networkConfig.isTestnet ? 'ST' : 'SP';
  
  if (!address.startsWith(expectedPrefix)) {
    return false;
  }

  // Stacks addresses are typically 39-41 characters
  if (address.length < 39 || address.length > 41) {
    return false;
  }

  return true;
}

/**
 * Get Stacks network instance
 */
export function getStacksNetwork() {
  return networkConfig.stacksNetwork;
}

/**
 * Get network info
 */
export function getNetworkInfo() {
  return {
    network: networkConfig.network,
    isTestnet: networkConfig.isTestnet,
    apiUrl: networkConfig.apiUrl,
    explorerUrl: networkConfig.explorerUrl,
  };
}

