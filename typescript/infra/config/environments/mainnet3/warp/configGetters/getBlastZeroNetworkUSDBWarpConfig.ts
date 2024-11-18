import { ethers } from 'ethers';

import {
  ChainMap,
  IsmType,
  RouterConfig,
  TokenRouterConfig,
  TokenType,
} from '@hyperlane-xyz/sdk';

const USDB_ADDRESS = '0x4300000000000000000000000000000000000003';

export const getBlastZeroNetworkUSDBWarpConfig = async (
  routerConfig: ChainMap<RouterConfig>,
): Promise<ChainMap<TokenRouterConfig>> => {
  const blast: TokenRouterConfig = {
    ...routerConfig.blast,
    type: TokenType.collateral,
    token: USDB_ADDRESS,
    interchainSecurityModule: {
      owner: ethers.constants.AddressZero,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };

  const zeronetwork: TokenRouterConfig = {
    ...routerConfig.zeronetwork,
    type: TokenType.synthetic,
    interchainSecurityModule: {
      owner: ethers.constants.AddressZero,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };
  return {
    blast,
    zeronetwork,
  };
};
