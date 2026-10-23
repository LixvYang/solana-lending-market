/**
 * 指令的中文名。IDL 里的名字(lending_account_borrow…)是给程序看的;列表里先给人看"借款",
 * 原名小字放在下面,对照解码器输出时仍然找得到。kind 决定配色:用户的资金动作 / 清算 / 池子管理。
 */
export type IxKind = 'supply' | 'borrow' | 'risk' | 'admin';

const NAMES: Record<string, [string, IxKind]> = {
  lending_account_deposit: ['存款', 'supply'],
  lending_account_withdraw: ['取款', 'supply'],
  lending_account_borrow: ['借款', 'borrow'],
  lending_account_repay: ['还款', 'borrow'],
  lending_account_liquidate: ['清算', 'risk'],
  marginfi_account_initialize: ['开户', 'admin'],
  marginfi_group_initialize: ['创建借贷组', 'admin'],
  marginfi_group_configure: ['配置借贷组', 'admin'],
  lending_pool_add_bank: ['上架资产', 'admin'],
  lending_pool_add_bank_with_seed: ['上架资产', 'admin'],
  lending_pool_configure_bank: ['调整资产参数', 'admin'],
  lending_pool_configure_bank_oracle: ['设置价格源', 'admin'],
  lending_pool_accrue_bank_interest: ['计息', 'admin'],
  lending_pool_collect_bank_fees: ['收取协议费', 'admin'],
};

export const ixLabel = (name: string): { label: string; kind: IxKind } => {
  const hit = NAMES[name];
  return hit ? { label: hit[0], kind: hit[1] } : { label: name, kind: 'admin' };
};
