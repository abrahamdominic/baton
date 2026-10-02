import { afterEach, describe, it, expect, vi } from "vitest";
import { isValidTransactionHash, verifyUsdcTransaction } from "./usdc";
import type { UsdcSettings } from "@/lib/config";

const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WALLET = "0xbA7on0000000000000000000000000000000000AA";
const FROM = "0x1111111111111111111111111111111111111111";
const TX_HASH = "0x" + "a".repeat(63) + "1";

const settings: UsdcSettings = {
  network: "base-test",
  token: "USDC",
  tokenAddress: TOKEN,
  rpcUrl: "https://rpc.test",
  walletAddress: WALLET,
  minConfirmations: 12,
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function padAddress(addr: string): string {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}

// $10.00 = 10,000,000 (6 decimals)
const TEN_DOLLAR_USDC = "0x989680";

/** $10.00 plus the 37-unit sub-cent nonce one specific order was issued. */
const TEN_DOLLAR_PLUS_NONCE = 10_000_037n;
const NONCE_HEX = "0x" + TEN_DOLLAR_PLUS_NONCE.toString(16);
const EXPECTED = TEN_DOLLAR_PLUS_NONCE;

function transferLog(to: string, valueHex: string) {
  return {
    address: TOKEN,
    topics: [TRANSFER_TOPIC, padAddress(FROM), padAddress(to)],
    data: valueHex,
  };
}

function makeFetchMock(overrides: { currentBlock?: number; txBlock?: number; receiptStatus?: string; logs?: unknown[]; rpcDown?: string[]; currentBlockMissing?: boolean } = {}) {
  const currentBlock = overrides.currentBlock ?? 1000;
  const txBlock = overrides.txBlock ?? 900;
  const tx = {
    hash: TX_HASH,
    blockNumber: "0x" + txBlock.toString(16),
    to: TOKEN,
    from: FROM,
  };
  const receipt = {
    status: overrides.receiptStatus ?? "0x1",
    logs: overrides.logs ?? [transferLog(WALLET, NONCE_HEX)],
  };
  return vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as { method: string };
    if (overrides.rpcDown?.includes(payload.method)) {
      return { ok: false, status: 502, json: async () => ({}) };
    }
    let result: unknown = null;
    switch (payload.method) {
      case "eth_getTransactionByHash":
        result = tx;
        break;
      case "eth_getTransactionReceipt":
        result = receipt;
        break;
      case "eth_blockNumber":
        if (overrides.currentBlockMissing) return { ok: true, json: async () => ({}) };
        result = "0x" + currentBlock.toString(16);
        break;
    }
    return { ok: true, json: async () => ({ result }) };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("isValidTransactionHash", () => {
  it("accepts 64-hex 0x hashes and rejects everything else", () => {
    expect(isValidTransactionHash(TX_HASH)).toBe(true);
    expect(isValidTransactionHash("0x" + "ab".repeat(31))).toBe(false);
    expect(isValidTransactionHash("0xabc")).toBe(false);
    expect(isValidTransactionHash("abc")).toBe(false);
    expect(isValidTransactionHash(null)).toBe(false);
    expect(isValidTransactionHash(42)).toBe(false);
  });
});

describe("verifyUsdcTransaction", () => {
  it("rejects malformed hashes before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyUsdcTransaction(settings, "0xabc", EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_hash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not_found when the tx does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ result: null }) })));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("confirms a matching USDC transfer to the configured wallet", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The credited plan price is the floored cent value, not the nonce dust.
      expect(result.valueMinor).toBe(1000);
      expect(result.valueOnchain).toBe(TEN_DOLLAR_PLUS_NONCE.toString());
      expect(result.from).toBe(FROM.toLowerCase());
      expect(result.recipient).toBe(WALLET.toLowerCase());
      expect(result.confirmations).toBe(101);
      expect(result.token).toBe("USDC");
    }
  });

  it("rejects transfers to the wrong recipient", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog("0x2222222222222222222222222222222222222222", NONCE_HEX)] }),
    );
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("recipient_mismatch");
  });

  it("rejects transfers whose amount does not match the plan price", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ logs: [transferLog(WALLET, "0x1")] }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("amount_mismatch");
  });

  /**
   * The payment-theft regression. A plain $10.00 transfer — a different order's
   * nonce, or no nonce at all — must not satisfy this order, no matter who
   * submits its hash. Accepting it lets an observer point somebody else's
   * transfer at their own pending order.
   */
  it("rejects a cent-exact transfer that does not carry this order's nonce", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ logs: [transferLog(WALLET, TEN_DOLLAR_USDC)] }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("amount_mismatch");
  });

  it("rejects another order's transfer when both are the same plan price", async () => {
    const otherOrder = EXPECTED + 1n;
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog(WALLET, "0x" + otherOrder.toString(16))] }),
    );
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("amount_mismatch");
  });

  it("rejects an underpayment below the exact order amount", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog(WALLET, "0x" + (EXPECTED - 1n).toString(16))] }),
    );
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("amount_mismatch");
  });

  /**
   * The double-spend regression, and the reason there is no tolerance setting.
   *
   * Overpayment was previously allowed up to `USDC_AMOUNT_TOLERANCE_MINOR`. An
   * attacker who opens two open orders whose figures fall inside that window
   * pays once and submits the same transfer to both: each order's check passes
   * because the transfer is >= its own expected amount. Two paid subscriptions,
   * one payment. Exact matching removes the window — a transfer satisfies an
   * order only if it carries that order's nonce and no other order's.
   */
  it("rejects an overpayment that would let one transfer satisfy two orders", async () => {
    const cheapOrder = EXPECTED + 90_000n; // $10.0090 — 9 cents less
    const attackerTransfer = EXPECTED + 1_000_000n; // one full dollar over

    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog(WALLET, "0x" + attackerTransfer.toString(16))] }),
    );
    const rich = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    const cheap = await verifyUsdcTransaction(settings, TX_HASH, cheapOrder);

    expect(rich.ok).toBe(false);
    if (!rich.ok) expect(rich.code).toBe("amount_mismatch");
    expect(cheap.ok).toBe(false);
    if (!cheap.ok) expect(cheap.code).toBe("amount_mismatch");
  });

  it("credits the plan price, not the on-chain figure, on an exact match", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 10,000,037 base units is $10.000037; the plan is credited $10.00.
      expect(result.valueOnchain).toBe("10000037");
      expect(result.valueMinor).toBe(1000);
    }
  });

  it("reports rpc_unavailable, not not_found, when the node cannot be reached", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ rpcDown: ["eth_getTransactionByHash"] }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    // A transport failure must stay retryable; a wrong "not_found" here made
    // every Base outage look like a permanently missing transaction.
    if (!result.ok) expect(result.code).toBe("rpc_unavailable");
  });

  it("reports rpc_unavailable when the receipt call fails", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ rpcDown: ["eth_getTransactionReceipt"] }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("rpc_unavailable");
  });

  it("fails closed when the chain head height is unavailable", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ currentBlockMissing: true }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    // Unknown head height means unknown confirmations. Defaulting them to zero
    // let a reorg-fresh transaction settle immediately.
    if (!result.ok) expect(result.code).toBe("insufficient_finality");
  });

  it("returns insufficient_finality before min confirmations are reached", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ currentBlock: 904 }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient_finality");
  });

  it("flags reverted transactions", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ receiptStatus: "0x0" }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("reverted");
  });

  it("flags transactions that do not interact with the USDC token", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog(WALLET, NONCE_HEX)] }),
    );
    // Force the tx.to away from the token contract.
    const originalFetch = makeFetchMock();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const res = await originalFetch(url, init);
      const body = (await res.json()) as { result?: Record<string, unknown> };
      if (body.result && body.result.hash) {
        body.result.to = "0x9999999999999999999999999999999999999999";
      }
      return { ok: true, json: async () => body };
    });
    const result = await verifyUsdcTransaction(settings, TX_HASH, EXPECTED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("token_mismatch");
  });
});