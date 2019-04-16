import BN from 'bn.js'
import debug from 'debug'
import { ethers } from 'ethers'
import Web3 from 'web3'
import { Address, Client, Contracts } from '.'
import { DPOS3 } from './contracts'
import { createDefaultClient } from './helpers'
import {
  GatewayUser,
  NewGatewayUserParams,
  GatewayUserParams,
  GatewayVersion
} from './gateway-user'
import {
  IValidator,
  ICandidate,
  ICandidateDelegations,
  IDelegatorDelegations
} from './contracts/dpos3'
import { getMetamaskSigner } from './solidity-helpers'
import { LocktimeTier, DelegationState } from './proto/dposv3_pb'

const log = debug('dpos-user')

export interface NewDPOSUserV3Params extends NewGatewayUserParams {
  dappchainDPOS: Contracts.DPOS3
}

export class DPOSUserV3 extends GatewayUser {
  private _dappchainDPOS: Contracts.DPOS3

  static async createOfflineUserAsync(params: GatewayUserParams): Promise<DPOSUserV3> {
    const provider = new ethers.providers.JsonRpcProvider(params.ethEndpoint)
    const wallet = new ethers.Wallet(params.ethereumPrivateKey!, provider)
    return DPOSUserV3.createUserAsync({
      wallet,
      ...params
    })
  }

  static createMetamaskUserAsync(params: GatewayUserParams): Promise<DPOSUserV3> {
    const wallet = getMetamaskSigner(params.web3!.currentProvider)
    return DPOSUserV3.createUserAsync({
      wallet,
      ...params
    })
  }

  static async createEthSignMetamaskUserAsync(params: GatewayUserParams): Promise<DPOSUserV3> {
    const gatewayUser = await GatewayUser.createEthSignMetamaskGatewayUserAsync(params)
    const dappchainDPOS = await DPOS3.createAsync(gatewayUser.client, gatewayUser.loomAddress)
    log('Connected to dappchain DPOS Contract')

    return new DPOSUserV3({
      wallet: gatewayUser.wallet,
      client: gatewayUser.client,
      address: gatewayUser.loomAddress,
      ethAddress: gatewayUser.ethAddress,
      gateway: gatewayUser.ethereumGateway,
      loomToken: gatewayUser.ethereumLoom,
      vmc: gatewayUser.ethereumVMC,
      dappchainGateway: gatewayUser.dappchainGateway,
      dappchainLoom: gatewayUser.dappchainLoom,
      dappchainDPOS,
      version: params.version
    })
  }

  static async createUserAsync(params: GatewayUserParams): Promise<DPOSUserV3> {
    const gatewayUser = await GatewayUser.createGatewayUserAsync(params)
    const dappchainDPOS = await DPOS3.createAsync(gatewayUser.client, gatewayUser.loomAddress)

    log('Connected to dappchain DPOS Contract')
    return new DPOSUserV3({
      wallet: gatewayUser.wallet,
      client: gatewayUser.client,
      address: gatewayUser.loomAddress,
      ethAddress: gatewayUser.ethAddress,
      gateway: gatewayUser.ethereumGateway,
      loomToken: gatewayUser.ethereumLoom,
      vmc: gatewayUser.ethereumVMC,
      dappchainGateway: gatewayUser.dappchainGateway,
      dappchainLoom: gatewayUser.dappchainLoom,
      addressMapper: gatewayUser.addressMapper,
      dappchainDPOS,
      version: params.version
    })
  }

  constructor(params: NewDPOSUserV3Params) {
    super(params)
    this._dappchainDPOS = params.dappchainDPOS
  }

  get dappchainDPOS(): Contracts.DPOS3 {
    return this._dappchainDPOS
  }

  listValidatorsAsync(): Promise<IValidator[]> {
    return this._dappchainDPOS.getValidatorsAsync()
  }

  listCandidatesAsync(): Promise<ICandidate[]> {
    return this._dappchainDPOS.getCandidatesAsync()
  }

  listAllDelegationsAsync(): Promise<Array<ICandidateDelegations>> {
    return this._dappchainDPOS.getAllDelegations()
  }

  listDelegationsAsync(candidate: string): Promise<ICandidateDelegations> {
    const address = this.prefixAddress(candidate)
    return this._dappchainDPOS.getDelegations(address)
  }

  checkAllDelegationsAsync(delegator?: string): Promise<IDelegatorDelegations> {
    const address = delegator ? this.prefixAddress(delegator) : this.loomAddress
    return this._dappchainDPOS.checkAllDelegationsAsync(address)
  }

  getTimeUntilElectionsAsync(): Promise<BN> {
    return this._dappchainDPOS.getTimeUntilElectionAsync()
  }

  /**
   * Delegates an amount of LOOM tokens to a candidate/validator
   *
   * @param candidate The candidate's hex address
   * @param amount The amount delegated
   */
  async delegateAsync(candidate: string, amount: BN, tier: LocktimeTier): Promise<void> {
    const address = this.prefixAddress(candidate)
    await this.dappchainLoom.approveAsync(this._dappchainDPOS.address, amount)
    return this._dappchainDPOS.delegateAsync(address, amount, tier)
  }

  /**
   * Redelegates an amount of LOOM tokens from a validator to another
   *
   * @param formerValidator The candidate's hex address
   * @param newValidator The candidate's hex address
   * @param amount The amount delegated
   */
  async redelegateAsync(
    formerValidator: string,
    validator: string,
    amount: BN,
    index: number
  ): Promise<void> {
    const validatorAddress = this.prefixAddress(validator)
    const formerValidatorAddress = this.prefixAddress(formerValidator)
    return this._dappchainDPOS.redelegateAsync(
      formerValidatorAddress,
      validatorAddress,
      amount,
      index
    )
  }

  /**
   * Undelegates an amount of LOOM tokens from a candidate/validator
   *
   * @param candidate The candidate's hex address
   * @param amount The amount to undelegate
   */
  async undelegateAsync(candidate: string, amount: BN, index: number): Promise<void> {
    const address = this.prefixAddress(candidate)
    await this._dappchainDPOS.unbondAsync(address, amount, index)
  }

  claimDelegationsAsync(validatorAddress: string): Promise<void> {
    const address = this.prefixAddress(validatorAddress)
    // When unbonding 0 it unbonds the full amount, and the 0th delegation is the rewards delegation
    return this._dappchainDPOS.unbondAsync(address, 0, 0)
  }

  /**
   * Returns the stake a delegator has delegated to a candidate/validator
   *
   * @param validator The validator's hex address
   * @param delegator The delegator's hex address
   */
  checkDelegationsAsync(
    validator: string,
    delegator?: string
  ): Promise<IDelegatorDelegations | null> {
    const validatorAddress = this.prefixAddress(validator)
    const delegatorAddress = delegator ? this.prefixAddress(delegator) : this.loomAddress
    return this._dappchainDPOS.checkDelegationAsync(validatorAddress, delegatorAddress)
  }

  // Iterates over all the delegator's reward delegations and unbonds the ones it can unbond
  async claimRewardsAsync(): Promise<void> {
    // get all delegations
    const delegations = await this._dappchainDPOS.checkAllDelegationsAsync(this.loomAddress)

    for (const d of delegations.delegationsArray) {
      // if it's the rewards delegation and it's already bonded
      if (d.index === 0 && d.state == DelegationState.BONDED) {
        this.dappchainDPOS.unbondAsync(d.validator, 0, 0)
      }
    }
  }

  // Iterates over all delegator delegations and returns 1 amount
  async checkRewardsAsync(owner?: string): Promise<BN> {
    const address = owner ? this.prefixAddress(owner) : this.loomAddress

    // get all delegations
    const delegations = await this._dappchainDPOS.checkAllDelegationsAsync(address)

    // get the 0th of each
    let total = new BN(0)
    for (const d of delegations.delegationsArray) {
      // if it's the rewards delegation and it's already bonded
      if (d.index === 0 && d.state == DelegationState.BONDED) {
        total.add(d.amount)
      }
    }

    return total
  }
}