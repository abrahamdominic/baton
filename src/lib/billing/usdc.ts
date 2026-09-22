import type { Cents } from "./types";
import { minorToUsdcOnchain, usdcOnchainToMinor } from "./amounts";
import type { UsdcSettings } from "@/lib/config";

/**
 * USDC payment verification against the Base network.
 *
 * Verification is performed server-side against a public JSON-RPC endpoint
 * (default: https://mainnet.base.org). Never trust a transaction hash supplied
 * by the frontend; the recipient wallet, token contract, amount, and finality
 * are all re-derived from chain data here.
 */

export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function isValidTransactionHash(hash: unknown): hash is string {
  return typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function isSameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

export type UsdcVerificationErrorCode =
  | "invalid_hash"
  | "not_found"
  | "not_mined"
  | "reverted"
  | "token_mismatch"
  | "recipient_mismatch"
  | "amount_mismatch"
  | "insufficient_finality"
  | "rpc_unavailable";

export type UsdcVerificationResult =
  | {
      ok: true;
      transactionHash: string;
      from: string;
      recipient: string;
      valueMinor: number;
      blockNumber: number;
      confirmations: number;
      network: string;
      token: string;
    }
  | { ok: false; code: UsdcVerificationErrorCode; detail?: string };

interface RpcRequestParams {
  method: string;
  params?: unknown[];
}

async function rpcCall(settings: UsdcSettings, method: string, params: unknown[]): Promise<unknown> {
  const body: RpcRequestParams = { method, params };
  let res: Response;
  try {
    res = await fetch(settings.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) return null;
    return json.result ?? null;
  } catch {
    return null;
  }
}

function hexToBigInt(value: string | null | undefined): bigint | null {
  if (!value || typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]*$/.test(value)) return null;
  return BigInt(value);
}

function hexToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return Number.parseInt(value, 16);
  }
  return null;
}

interface ParsedTransfer {
  contract: string;
  from: string;
  to: string;
  value: bigint;
}

/**
 * Verify that `transactionHash` paid exactly the expected amount to the
 * configured Baton USDC wallet, on the Base network.
 */
export async function verifyUsdcTransaction(
  settings: UsdcSettings,
  transactionHash: string,
  expectedAmountMinor: Cents,
): Promise<UsdcVerificationResult> {
  if (!isValidTransactionHash(transactionHash)) {
    return { ok: false, code: "invalid_hash", detail: "transaction hash does not look like a Base transaction hash" };
  }

  const tx = (await rpcCall(settings, "eth_getTransactionByHash", [transactionHash])) as Record<string, unknown> | null;
  if (!tx || tx.hash === null || tx.hash === undefined) {
    return { ok: false, code: "not_found", detail: "transaction does not exist on this network" };
  }
  if (!tx.blockNumber) {
    return { ok: false, code: "not_mined", detail: "transaction has not been mined yet" };
  }

  const receipt = (await rpcCall(settings, "eth_getTransactionReceipt", [transactionHash])) as Record<string, unknown> | null;
  if (!receipt) {
    return { ok: false, code: "not_mined", detail: "no receipt available for this transaction" };
  }
  const status = hexToNumber(receipt.status);
  if (status !== 1) {
    return { ok: false, code: "reverted", detail: "transaction did not succeed (status != 1)" };
  }

  // The outer `to` of a USDC transfer is the token contract.
  const txTo = typeof tx.to === "string" ? tx.to : null;
  if (!txTo || !isSameAddress(txTo, settings.tokenAddress)) {
    return {
      ok: false,
      code: "token_mismatch",
      detail: "transaction does not interact with the USDC token contract",
    };
  }

  // Decode ERC-20 Transfer logs emitted by the token contract in this tx.
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const transfers: ParsedTransfer[] = [];
  for (const raw of logs as Record<string, unknown>[]) {
    const address = typeof raw.address === "string" ? raw.address : "";
    const topics = Array.isArray(raw.topics) ? (raw.topics as unknown[]) : [];
    const data = typeof raw.data === "string" ? raw.data : "";
    if (
      isSameAddress(address, settings.tokenAddress) &&
      topics.length >= 3 &&
      topics[0] === TRANSFER_EVENT_TOPIC
    ) {
      const fromTopic = typeof topics[1] === "string" ? topics[1] : "";
      const toTopic = typeof topics[2] === "string" ? topics[2] : "";
      const value = hexToBigInt(data);
      if (fromTopic && toTopic && value !== null) {
        transfers.push({
          contract: address,
          from: `0x${fromTopic.slice(26)}`,
          to: `0x${toTopic.slice(26)}`,
          value,
        });
      }
    }
  }
  if (transfers.length === 0) {
    return { ok: false, code: "token_mismatch", detail: "no USDC transfers found in this transaction" };
  }

  // Only transfers to Baton's wallet matter.
  const toWallet = transfers.filter((t) => isSameAddress(t.to, settings.walletAddress));
  if (toWallet.length === 0) {
    return {
      ok: false,
      code: "recipient_mismatch",
      detail: "no USDC was transferred to the configured Baton payment wallet",
    };
  }

  const totalValue = toWallet.reduce((n, t) => n + t.value, 0n);
  let valueMinor: number;
  try {
    valueMinor = usdcOnchainToMinor(Number(totalValue));
  } catch {
    return {
      ok: false,
      code: "amount_mismatch",
      detail: "transferred amount has sub-cent precision and cannot match a plan price",
    };
  }

  const expectedOnchain = minorToUsdcOnchain(expectedAmountMinor);
  const toleranceOnchain = minorToUsdcOnchain(settings.amountToleranceMinor);
  const diff = totalValue - BigInt(expectedOnchain);
  if (diff < 0n || diff > BigInt(toleranceOnchain)) {
    return {
      ok: false,
      code: "amount_mismatch",
      detail: `expected ${expectedAmountMinor} minor units, received ${valueMinor}`,
    };
  }

  const txBlock = hexToNumber(tx.blockNumber);
  const currentBlockRaw = await rpcCall(settings, "eth_blockNumber", []);
  const currentBlock = hexToNumber(currentBlockRaw);
  let confirmations = 0;
  if (txBlock !== null) {
    confirmations = currentBlock !== null ? Math.max(0, currentBlock - txBlock + 1) : 0;
  }

  if (txBlock !== null && currentBlock !== null && confirmations < settings.minConfirmations) {
    return {
      ok: false,
      code: "insufficient_finality",
      detail: `transaction has ${confirmations} confirmations (need ${settings.minConfirmations})`,
    };
  }

  const from = toWallet[0]?.from ?? "";
  return {
    ok: true,
    transactionHash,
    from,
    recipient: normalizeAddress(settings.walletAddress),
    valueMinor,
    blockNumber: txBlock ?? 0,
    confirmations,
    network: settings.network,
    token: settings.token,
  };
}