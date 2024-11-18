import {
  ChainMap,
  IsmType,
  RouterConfig,
  TokenRouterConfig,
  TokenType,
} from '@hyperlane-xyz/sdk';
import { Address } from '@hyperlane-xyz/utils';

const collateralAddresses: ChainMap<Address> = {
  ethereum: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  mode: '0xcDd475325D6F564d27247D1DddBb0DAc6fA0a5CF',
  scroll: '0x3C1BCa5a656e69edCD0D4E36BEbb3FcDAcA60Cf1',
};

const EXISTING_OWNER = '0x723e7694dc346e5a15fB6F6A0144479aC624C66F'; // Le Deployer

export const getEthereumModeScrollZeronetworkWBTCConfig = async (
  routerConfig: ChainMap<RouterConfig>,
): Promise<ChainMap<TokenRouterConfig>> => {
  const ethereum: TokenRouterConfig = {
    ...routerConfig.ethereum,
    type: TokenType.collateral,
    token: collateralAddresses.ethereum,
    interchainSecurityModule: {
      owner: EXISTING_OWNER,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };

  const mode: TokenRouterConfig = {
    ...routerConfig.mode,
    type: TokenType.collateral,
    token: collateralAddresses.mode,
    interchainSecurityModule: {
      owner: EXISTING_OWNER,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };

  const scroll: TokenRouterConfig = {
    ...routerConfig.scroll,
    type: TokenType.collateral,
    token: collateralAddresses.token,
    interchainSecurityModule: {
      owner: EXISTING_OWNER,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };

  const zeronetwork: TokenRouterConfig = {
    ...routerConfig.zeronetwork,
    type: TokenType.synthetic,
    interchainSecurityModule: {
      owner: EXISTING_OWNER,
      type: IsmType.FALLBACK_ROUTING,
      domains: {},
    },
  };

  return {
    ethereum,
    mode,
    scroll,
    zeronetwork,
  };
};
