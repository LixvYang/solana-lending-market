/** 库存未知(null/undefined)时不拦截，交给报价接口按链上余额判断。 */
export function deskIsShort(out: bigint | null, available: string | null | undefined): boolean {
  return out !== null && available != null && out > BigInt(available);
}
