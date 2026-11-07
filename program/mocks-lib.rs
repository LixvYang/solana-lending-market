// 本仓库对上游 mrgn-0.1.0 programs/mocks/src/lib.rs 的覆盖版本(build.sh 拉取上游后复制过去)。
// 改动只有两处，见 docs/decisions.md D-029:
//   1. write 改价必须由价格管理员签名(上游只要求目标账户签名，而我们的价格账户密钥由公开字符串派生，任何人都能改价)。
//   2. 新增 refresh_timestamp:任何人可调用，只把价格时间刷新为链上当前时间，价格数值不变。
// 其余指令与上游一致。__PRICE_ADMIN__ / __ENFORCE_WRITE_AUTHORITY__ 由 build.sh 替换。
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

pub mod errors;
pub mod instructions;
pub mod macros;
pub mod state;

use crate::instructions::*;

declare_id!("5XaaR94jBubdbrRrNW7DtRvZeWvLhSHkEGU3jHTEXV3C");

/// 唯一能改价的钱包(部署者)。用 base58 字符串比较：pubkey! 宏需要 mocks 并未直接依赖的 solana_program crate。
pub const PRICE_ADMIN: &str = "__PRICE_ADMIN__";
/// 三步不停机上线的中间态为 false(write 暂不检查管理员，旧调用照常可用),最终版本为 true。
pub const ENFORCE_WRITE_AUTHORITY: bool = __ENFORCE_WRITE_AUTHORITY__;

// Switchboard PullFeedAccountData 的布局，与 src/decoder/switchboard.ts 的 OFFSET 一致。
const PULL_FEED_DISCRIMINATOR: [u8; 8] = [196, 27, 108, 196, 10, 215, 219, 40];
const SAMPLE_SIZE_OFFSET: usize = 2215;
const TIMESTAMP_OFFSET: usize = 2216;
/// 结果区 6 个 i128 之后再空 8 字节，紧接 3 个 u64 slot。
const SLOTS_OFFSET: usize = 2264 + 6 * 16 + 8;

#[program]
pub mod mocks {
    use super::*;
    use std::io::Write as IoWrite;

    /// Do nothing
    pub fn do_nothing(ctx: Context<DoNothing>) -> Result<()> {
        instructions::do_nothing::do_nothing(ctx)
    }

    /// Init authority for fake jupiter-like swap pools
    pub fn init_pool_auth(ctx: Context<InitPoolAuth>, nonce: u16) -> Result<()> {
        instructions::init_pool_auth::init_pool_auth(ctx, nonce)
    }

    /// Execute an exchange of a:b like-jupiter. You set the amount a sent and b received.
    pub fn swap_like_jupiter<'info>(
        ctx: Context<'_, '_, '_, 'info, SwapLikeJupiter<'info>>,
        amt_a: u64,
        amt_b: u64,
    ) -> Result<()> {
        instructions::swap_like_jupiter::SwapLikeJupiter::swap_like_jup(ctx, amt_a, amt_b)
    }

    #[derive(Accounts)]
    pub struct Write<'info> {
        #[account(mut)]
        target: Signer<'info>,
    }

    /// 把字节写进目标账户。价格管理员放在 remaining_accounts[0] 并签名:
    /// 不写进 Write 结构，是为了中间态下只带 1 个账户的旧调用仍能解析。
    pub fn write<'info>(ctx: Context<'_, '_, '_, 'info, Write<'info>>, offset: u64, data: Vec<u8>) -> Result<()> {
        if ENFORCE_WRITE_AUTHORITY {
            let authority = ctx.remaining_accounts.first().ok_or(ProgramError::MissingRequiredSignature)?;
            if !authority.is_signer || authority.key().to_string() != PRICE_ADMIN {
                return Err(ProgramError::MissingRequiredSignature.into());
            }
        }
        let account_data = ctx.accounts.target.to_account_info().data;
        let borrow_data = &mut *account_data.borrow_mut();
        let offset = offset as usize;

        Ok((&mut borrow_data[offset..]).write_all(&data[..])?)
    }

    #[derive(Accounts)]
    pub struct RefreshTimestamp<'info> {
        /// CHECK: 只接受本程序拥有、PullFeed 判别符且已经有价格的账户(下面逐项检查)。
        #[account(mut, owner = crate::ID)]
        feed: UncheckedAccount<'info>,
    }

    /// 任何人可调用：把 last_update_timestamp 与 3 个 slot 设为当前链上值，价格数值一个字节都不动。
    pub fn refresh_timestamp(ctx: Context<RefreshTimestamp>) -> Result<()> {
        let clock = Clock::get()?;
        let info = ctx.accounts.feed.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        if data.len() < SLOTS_OFFSET + 24 || data[..8] != PULL_FEED_DISCRIMINATOR || data[SAMPLE_SIZE_OFFSET] == 0 {
            return Err(ProgramError::InvalidAccountData.into());
        }
        data[TIMESTAMP_OFFSET..TIMESTAMP_OFFSET + 8].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
        for i in 0..3 {
            let at = SLOTS_OFFSET + i * 8;
            data[at..at + 8].copy_from_slice(&clock.slot.to_le_bytes());
        }
        Ok(())
    }
}
