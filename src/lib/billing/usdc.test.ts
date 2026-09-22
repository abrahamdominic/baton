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
  amountToleranceMinor: 0,
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function padAddress(addr: string): string {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}

// $10.00 = 10,000,000 (6 decimals)
const TEN_DOLLAR_USDC = "0x989680";

function transferLog(to: string, valueHex: string) {
  return {
    address: TOKEN,
    topics: [TRANSFER_TOPIC, padAddress(FROM), padAddress(to)],
    data: valueHex,
  };
}

function makeFetchMock(overrides: { currentBlock?: number; txBlock?: number; receiptStatus?: string; logs?: unknown[] } = {}) {
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
    logs: overrides.logs ?? [transferLog(WALLET, TEN_DOLLAR_USDC)],
  };
  return vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as { method: string };
    let result: unknown = null;
    switch (payload.method) {
      case "eth_getTransactionByHash":
        result = tx;
        break;
      case "eth_getTransactionReceipt":
        result = receipt;
        break;
      case "eth_blockNumber":
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
    const result = await verifyUsdcTransaction(settings, "0xabc", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_hash");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not_found when the tx does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ result: null }) })));
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("confirms a matching USDC transfer to the configured wallet", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valueMinor).toBe(1000);
      expect(result.recipient).toBe(WALLET.toLowerCase());
      expect(result.confirmations).toBe(101);
      expect(result.token).toBe("USDC");
    }
  });

  it("rejects transfers to the wrong recipient", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog("0x2222222222222222222222222222222222222222", TEN_DOLLAR_USDC)] }),
    );
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("recipient_mismatch");
  });

  it("rejects transfers whose amount does not match the plan price", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ logs: [transferLog(WALLET, "0x1")] }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("amount_mismatch");
  });

  it("returns insufficient_finality before min confirmations are reached", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ currentBlock: 904 }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient_finality");
  });

  it("flags reverted transactions", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ receiptStatus: "0x0" }));
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("reverted");
  });

  it("flags transactions that do not interact with the USDC token", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ logs: [transferLog(WALLET, TEN_DOLLAR_USDC)] }),
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
    const result = await verifyUsdcTransaction(settings, TX_HASH, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("token_mismatch");
  });
});