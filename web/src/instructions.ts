/**
 * 指令的中文名。IDL 里的名字(lending_account_borrow…)是给程序看的;列表里先给人看"借款",
 * 原名小字放在下面,对照解码器输出时仍然找得到。kind 决定配色:用户的资金动作 / 清算 / 池子管理。
 */
export type IxKind = 'supply' | 'borrow' | 'risk' | 'admin';

import type { Translation } from './i18n';

const NAMES: Record<string, [keyof Translation, IxKind]> = {
  lending_account_deposit: ['operationSupply', 'supply'],
  lending_account_withdraw: ['operationWithdraw', 'supply'],
  lending_account_borrow: ['operationBorrow', 'borrow'],
  lending_account_repay: ['operationRepay', 'borrow'],
  lending_account_liquidate: ['operationLiquidator', 'risk'],
  marginfi_account_initialize: ['instructionOpenAccount', 'admin'],
  marginfi_group_initialize: ['instructionCreateGroup', 'admin'],
  marginfi_group_configure: ['instructionConfigureGroup', 'admin'],
  lending_pool_add_bank: ['instructionListAsset', 'admin'],
  lending_pool_add_bank_with_seed: ['instructionListAsset', 'admin'],
  lending_pool_configure_bank: ['instructionConfigureAsset', 'admin'],
  lending_pool_configure_bank_oracle: ['instructionSetOracle', 'admin'],
  lending_pool_accrue_bank_interest: ['instructionAccrueInterest', 'admin'],
  lending_pool_collect_bank_fees: ['instructionCollectFees', 'admin'],
};

export const ixLabel = (name: string, t: Translation): { label: string; kind: IxKind } => {
  const hit = NAMES[name];
  return hit ? { label: t[hit[0]] as string, kind: hit[1] } : { label: name, kind: 'admin' };
};
