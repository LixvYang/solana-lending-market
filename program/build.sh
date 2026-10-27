#!/usr/bin/env bash
# 构建 marginfi(mrgn-0.1.0)与 mocks 程序,产物放 program/out/。
# 为什么要补丁 program id:上游的 id 我们没有私钥,无法部署到同一地址。
# MODE=devnet(默认):带 devnet feature,价格走 Switchboard On-Demand,检查价格时间,见 docs/decisions.md D-007。
# MODE=mock:不带 cluster feature,PYTH_ID 指向 mocks 程序且忽略价格时间,见 D-003(可选备用路径)。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/mrgnlabs/marginfi-v2}"
UPSTREAM_TAG="${UPSTREAM_TAG:-mrgn-0.1.0}"
MODE="${MODE:-devnet}"
# PRICE_ORACLE=mock(默认):marginfi 认 mocks 程序拥有的账户为 Switchboard 价格账户(布局相同,价格由我们写入)。
#   原因:devnet 的 Switchboard oracle 离线,无法 crank,见 docs/decisions.md D-008。
# PRICE_ORACLE=switchboard:保持官方 devnet On-Demand 程序,oracle 恢复后使用。
PRICE_ORACLE="${PRICE_ORACLE:-mock}"
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/install/releases/2.1.20/solana-release/bin}"
export PATH="$SOLANA_BIN:$PATH"

SRC="$ROOT/.upstream"
OUT="$ROOT/out"
mkdir -p "$OUT/keys"

# 1. 拉取上游固定版本
if [ ! -d "$SRC/.git" ]; then
  git clone --no-checkout "$UPSTREAM_REPO" "$SRC"
fi
git -C "$SRC" checkout -q -f "$UPSTREAM_TAG"
git -C "$SRC" clean -fdq programs

# 1b. mocks 程序用本仓库的覆盖版(D-029):改价要价格管理员签名，新增任何人可调的 refresh_timestamp。
#   PRICE_ADMIN 默认取 ANCHOR_WALLET 的公钥;MOCKS_WRITE_AUTH=open 只用于三步上线的中间那一步(write 暂不检查管理员)。
PRICE_ADMIN="${PRICE_ADMIN:-$( [ -n "${ANCHOR_WALLET:-}" ] && solana-keygen pubkey "$ANCHOR_WALLET" )}"
[ -n "$PRICE_ADMIN" ] || { echo "需要 PRICE_ADMIN 或 ANCHOR_WALLET(价格管理员)" >&2; exit 1; }
MOCKS_WRITE_AUTH="${MOCKS_WRITE_AUTH:-enforce}"
case "$MOCKS_WRITE_AUTH" in enforce) ENFORCE=true ;; open) ENFORCE=false ;; *) echo "MOCKS_WRITE_AUTH 只能是 enforce 或 open" >&2; exit 1 ;; esac
cp "$ROOT/mocks-lib.rs" "$SRC/programs/mocks/src/lib.rs"
perl -pi -e "s/__PRICE_ADMIN__/$PRICE_ADMIN/g; s/__ENFORCE_WRITE_AUTHORITY__/$ENFORCE/g" "$SRC/programs/mocks/src/lib.rs"

# 2. 生成自己的 program keypair(已存在则复用,保证地址稳定)
for name in marginfi mocks; do
  [ -f "$OUT/keys/$name.json" ] || solana-keygen new --no-bip39-passphrase -s -o "$OUT/keys/$name.json" >/dev/null
done
MARGINFI_ID="$(solana-keygen pubkey "$OUT/keys/marginfi.json")"
MOCKS_ID="$(solana-keygen pubkey "$OUT/keys/mocks.json")"

# 3. 补丁:上游 localnet 地址 -> 我们自己的地址(仅限 programs/ 源码)
OLD_MARGINFI="2jGhuVUuy3umdzByFx8sNWUAaf5vaeuDm78RDPEnhrMr"
OLD_MOCKS="5XaaR94jBubdbrRrNW7DtRvZeWvLhSHkEGU3jHTEXV3C"
OLD_MARGINFI_DEVNET="neetcne3Ctrrud7vLdt2ypMm21gZHGN2mCmqWaMVcBQ" # devnet feature 分支的 declare_id
OLD_SWITCHBOARD_DEVNET="Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2" # devnet feature 下的 SWITCHBOARD_PULL_ID
SWITCHBOARD_ID="$OLD_SWITCHBOARD_DEVNET"
[ "$PRICE_ORACLE" = "mock" ] && SWITCHBOARD_ID="$MOCKS_ID"
grep -rl -e "$OLD_MARGINFI" -e "$OLD_MOCKS" -e "$OLD_MARGINFI_DEVNET" -e "$OLD_SWITCHBOARD_DEVNET" "$SRC/programs" --include='*.rs' | while read -r f; do
  perl -pi -e "s/$OLD_MARGINFI/$MARGINFI_ID/g; s/$OLD_MOCKS/$MOCKS_ID/g; s/$OLD_MARGINFI_DEVNET/$MARGINFI_ID/g; s/$OLD_SWITCHBOARD_DEVNET/$SWITCHBOARD_ID/g" "$f"
done

# 4. 构建
if [ "$MODE" = "devnet" ]; then
  FEATURES=(--no-default-features --features devnet)
else
  FEATURES=(--no-default-features)
fi
cargo build-sbf --manifest-path "$SRC/programs/marginfi/Cargo.toml" "${FEATURES[@]}" --sbf-out-dir "$OUT"
cargo build-sbf --manifest-path "$SRC/programs/mocks/Cargo.toml" --no-default-features --sbf-out-dir "$OUT"

printf '{"marginfi":"%s"}\n' "$MARGINFI_ID" > "$OUT/program-ids.json.tmp"
# 5. 生成 IDL 并写到入库位置(src/decoder/idl/)。解码器、剧本和测试都读这一份，不读被忽略的构建产物。
#    anchor CLI 内部做的就是 idl-build 测试钩子 + 拼接；我们不装 anchor 0.30.1 CLI，所以自己拼(见 assemble-idl.py)。
#    用自己的 keypair 构建时程序地址会变，IDL 里的 address 也随之更新；SKIP_IDL=1 可跳过。
if [ "${SKIP_IDL:-0}" != "1" ]; then
  ANCHOR_IDL_BUILD_PROGRAM_PATH="$SRC/programs/marginfi" ANCHOR_IDL_BUILD_SKIP_LINT=true ANCHOR_IDL_BUILD_RESOLUTION=true \
    cargo test --manifest-path "$SRC/programs/marginfi/Cargo.toml" --no-default-features --features idl-build,devnet \
    __anchor_private_print_idl --lib -- --show-output --test-threads=1 > "$OUT/idl-build.log" 2>&1
  python3 "$ROOT/assemble-idl.py" "$OUT/idl-build.log" "$ROOT/../src/decoder/idl/marginfi.idl.json" "$OUT/program-ids.json.tmp"
fi

echo "mode:     $MODE (price oracle: $PRICE_ORACLE)"
echo "marginfi: $MARGINFI_ID"
echo "mocks:    $MOCKS_ID"
printf '{"mode":"%s","priceOracle":"%s","marginfi":"%s","mocks":"%s"}\n' "$MODE" "$PRICE_ORACLE" "$MARGINFI_ID" "$MOCKS_ID" > "$OUT/program-ids.json"
