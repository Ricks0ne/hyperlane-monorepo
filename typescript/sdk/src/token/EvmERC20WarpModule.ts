import { MailboxClient__factory } from '@hyperlane-xyz/core';
import {
  Address,
  ProtocolType,
  configDeepEquals,
  normalizeConfig,
  rootLogger,
} from '@hyperlane-xyz/utils';

import { HyperlaneAddresses } from '../contracts/types.js';
import {
  HyperlaneModule,
  HyperlaneModuleParams,
} from '../core/AbstractHyperlaneModule.js';
import { HyperlaneProxyFactoryDeployer } from '../deploy/HyperlaneProxyFactoryDeployer.js';
import { ProxyFactoryFactories } from '../deploy/contracts.js';
import { EvmIsmModule } from '../ism/EvmIsmModule.js';
import { IsmConfig } from '../ism/types.js';
import { MultiProvider } from '../providers/MultiProvider.js';
import { AnnotatedEV5Transaction } from '../providers/ProviderType.js';
import { ChainNameOrId } from '../types.js';

import { EvmERC20WarpRouteReader } from './EvmERC20WarpRouteReader.js';
import { HypERC20Deployer } from './deploy.js';
import { TokenRouterConfig, TokenRouterConfigSchema } from './schemas.js';

export class EvmERC20WarpModule extends HyperlaneModule<
  ProtocolType.Ethereum,
  TokenRouterConfig,
  {
    deployedTokenRoute: Address;
  }
> {
  protected logger = rootLogger.child({
    module: 'EvmERC20WarpModule',
  });
  reader: EvmERC20WarpRouteReader;

  constructor(
    protected readonly multiProvider: MultiProvider,
    args: HyperlaneModuleParams<
      TokenRouterConfig,
      {
        deployedTokenRoute: Address;
      }
    >,
  ) {
    super(args);
    this.reader = new EvmERC20WarpRouteReader(multiProvider, args.chain);
  }

  /**
   * Retrieves the token router configuration for the specified address.
   *
   * @param address - The address to derive the token router configuration from.
   * @returns A promise that resolves to the token router configuration.
   */
  public async read(): Promise<TokenRouterConfig> {
    return this.reader.deriveWarpRouteConfig(
      this.args.addresses.deployedTokenRoute,
    );
  }

  /**
   * Updates the Warp Route contract with the provided configuration.
   *
   * @param expectedConfig - The configuration for the token router to be updated.
   * @returns An array of Ethereum transactions that were executed to update the contract, or an error if the update failed.
   */
  public async update(
    expectedConfig: TokenRouterConfig,
  ): Promise<AnnotatedEV5Transaction[]> {
    TokenRouterConfigSchema.parse(expectedConfig);
    const actualConfig = await this.read();

    const updateTransactions: AnnotatedEV5Transaction[] = [];
    const updateIsmTx = await this.updateIsm(actualConfig, expectedConfig);
    if (updateIsmTx) {
      updateTransactions.push(updateIsmTx);
    }

    return updateTransactions;
  }

  /**
   * Deploys and updates an existing Warp route ISM with a given config.
   *
   * @param actualConfig - The on-chain router configuration, including the ISM configuration.
   * @param expectedconfig - The expected token router configuration, including the ISM configuration.
   * @returns Ethereum transaction that need to be executed to update the ISM configuration.
   */
  async updateIsm(
    actualConfig: TokenRouterConfig,
    expectedconfig: TokenRouterConfig,
  ): Promise<AnnotatedEV5Transaction | undefined> {
    const expectedIsmConfig = normalizeConfig(
      expectedconfig.interchainSecurityModule,
    );
    const actualIsmConfig = normalizeConfig(
      actualConfig.interchainSecurityModule,
    );

    let updateTransaction;
    if (!configDeepEquals(expectedIsmConfig, actualIsmConfig)) {
      const deployedIsm = await this.deployIsm(
        expectedconfig.ismFactoryAddresses as HyperlaneAddresses<ProxyFactoryFactories>,
        expectedIsmConfig,
        expectedconfig.mailbox,
      );
      const contractToUpdate = MailboxClient__factory.connect(
        this.args.addresses.deployedTokenRoute,
        this.multiProvider.getProvider(this.args.chain),
      );
      updateTransaction = {
        annotation: `Setting ISM for Warp Route to ${deployedIsm}`,
        chainId: Number(this.multiProvider.getChainId(this.args.chain)),
        to: contractToUpdate.address,
        data: contractToUpdate.interface.encodeFunctionData(
          'setInterchainSecurityModule',
          [deployedIsm],
        ),
      };
    }
    return updateTransaction;
  }

  /**
   * Deploys the ISM using the provided configuration.
   *
   * @param config - The configuration for the ISM to be deployed.
   * @returns The config used to deploy the Ism with address attached
   */
  public async deployIsm(
    ismFactoryAddresses: HyperlaneAddresses<ProxyFactoryFactories>,
    interchainSecurityModule: IsmConfig,
    mailbox: Address,
  ): Promise<Address> {
    const ism = await EvmIsmModule.create({
      chain: this.args.chain,
      config: interchainSecurityModule,
      deployer: new HyperlaneProxyFactoryDeployer(this.multiProvider),
      factories: ismFactoryAddresses,
      multiProvider: this.multiProvider,
      mailbox,
    });

    // Attach the deployedIsm address
    return ism.serialize().deployedIsm;
  }

  /**
   * Deploys the Warp Route.
   *
   * @param chain - The chain to deploy the module on.
   * @param config - The configuration for the token router.
   * @param multiProvider - The multi-provider instance to use.
   * @returns A new instance of the EvmERC20WarpHyperlaneModule.
   */
  public static async create(params: {
    chain: ChainNameOrId;
    config: TokenRouterConfig;
    multiProvider: MultiProvider;
  }): Promise<EvmERC20WarpModule> {
    const { chain, config, multiProvider } = params;
    const chainName = multiProvider.getChainName(chain);
    const deployer = new HypERC20Deployer(multiProvider);
    const deployedContracts = await deployer.deployContracts(chainName, config);

    return new EvmERC20WarpModule(multiProvider, {
      addresses: {
        deployedTokenRoute: deployedContracts[config.type].address,
      },
      chain,
      config,
    });
  }
}
