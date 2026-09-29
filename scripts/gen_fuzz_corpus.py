#!/usr/bin/env python3
"""
Generate structured binary seed files for the create_vesting_stream fuzz corpus.

Input layout (all little-endian, MIN_INPUT = 88 bytes):
  [0..16)   rate            – i128
  [16..20)  cliff_duration  – u32
  [20..24)  total_duration  – u32
  [24..56)  sponsor_bytes   – 32 bytes
  [56..88)  recipient_bytes – 32 bytes
  [88..)    token_data      – variable-length bytes

Run from the project root:
    python3 scripts/gen_fuzz_corpus.py
"""

import os
import struct

CORPUS_DIR = "fuzz/corpus/create_vesting_stream"

# Two distinct 32-byte address stand-ins
SPONSOR_A   = bytes([0x01] * 32)
SPONSOR_B   = bytes([0x02] * 32)
RECIPIENT_A = bytes([0x03] * 32)   # different from SPONSOR_A/B

# A canonical 32-byte token address (all 0x04)
TOKEN_32 = bytes([0x04] * 32)

# A unicode token string ("🌙token" encodes to 10 bytes in UTF-8)
TOKEN_UNICODE = "🌙token".encode("utf-8")   # b'\xf0\x9f\x8c\x99token'

I128_MAX = (1 << 127) - 1
U32_MAX  = (1 << 32) - 1

def pack(rate: int, cliff: int, total: int,
         sponsor: bytes = SPONSOR_A,
         recipient: bytes = RECIPIENT_A,
         token: bytes = TOKEN_32) -> bytes:
    """Assemble one complete fuzz input."""
    assert len(sponsor) == 32 and len(recipient) == 32
    # i128 little-endian: Python's struct only goes up to q (int64) so do it manually
    r_bytes = rate.to_bytes(16, byteorder="little", signed=True)
    c_bytes = struct.pack("<I", cliff)
    t_bytes = struct.pack("<I", total)
    return r_bytes + c_bytes + t_bytes + sponsor + recipient + token


def write_seed(name: str, data: bytes) -> None:
    path = os.path.join(CORPUS_DIR, name)
    with open(path, "wb") as f:
        f.write(data)
    print(f"  wrote {path}  ({len(data)} bytes)")


def main() -> None:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    print(f"Generating corpus in {CORPUS_DIR}/\n")

    seeds: list[tuple[str, bytes]] = [
        # ── Error-path seeds ──────────────────────────────────────────────

        # 1. rate = 0  → InvalidRate
        ("01_zero_rate",
         pack(rate=0, cliff=50, total=200)),

        # 2. rate = -1  → InvalidRate
        ("02_negative_rate_minus_one",
         pack(rate=-1, cliff=50, total=200)),

        # 3. rate = i128::MIN  → InvalidRate (most-negative)
        ("03_negative_rate_min",
         pack(rate=-(1 << 127), cliff=50, total=200)),

        # 4. total = cliff  → InvalidDuration
        ("04_cliff_equals_total",
         pack(rate=10, cliff=100, total=100)),

        # 5. total < cliff  → InvalidDuration
        ("05_total_less_than_cliff",
         pack(rate=10, cliff=200, total=100)),

        # 6. rate = i128::MAX, total = 1  → DepositOverflow boundary (just fits: 170…07 * 1 = OK)
        #    Actually i128::MAX * 1 == i128::MAX which does NOT overflow.
        #    Use rate = i128::MAX, total = 2 to force overflow.
        ("06_overflow_rate_max_total_2",
         pack(rate=I128_MAX, cliff=0, total=2)),

        # 7. rate = i128::MAX, total = 1  → no overflow (boundary: exactly i128::MAX)
        ("07_rate_max_total_1_no_overflow",
         pack(rate=I128_MAX, cliff=0, total=1)),

        # 8. sponsor == recipient  → InvalidRecipient
        ("08_sponsor_equals_recipient",
         pack(rate=10, cliff=50, total=200,
              sponsor=SPONSOR_A, recipient=SPONSOR_A)),

        # 9. Empty token data  → EmptyTokenAddress
        ("09_empty_token",
         pack(rate=10, cliff=50, total=200, token=b"")),

        # 10. Unicode / multi-byte token string
        ("10_unicode_token",
         pack(rate=10, cliff=50, total=200, token=TOKEN_UNICODE)),

        # ── Valid / happy-path seeds ──────────────────────────────────────

        # 11. Minimal valid stream: cliff=0, total=1, rate=1
        ("11_minimal_valid",
         pack(rate=1, cliff=0, total=1)),

        # 12. cliff = total - 1  (maximum valid cliff)
        ("12_max_cliff",
         pack(rate=5, cliff=U32_MAX - 1, total=U32_MAX)),

        # 13. Large realistic stream: rate=1000, cliff=17280 (~1 day), total=172800 (~10 days)
        ("13_realistic_stream",
         pack(rate=1000, cliff=17280, total=172800)),

        # 14. rate=1, total=u32::MAX  (large but non-overflowing: 1 * 2^32-1 < i128::MAX)
        ("14_rate_1_total_u32_max",
         pack(rate=1, cliff=0, total=U32_MAX)),

        # 15. Binary / non-UTF-8 token data
        ("15_binary_token",
         pack(rate=10, cliff=50, total=200,
              token=bytes(range(256)))),
    ]

    for name, data in seeds:
        write_seed(name, data)

    print(f"\nTotal: {len(seeds)} corpus files written.")


if __name__ == "__main__":
    main()
