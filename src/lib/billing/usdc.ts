import { ONCHAIN_UNITS_PER_CENT } from "./amounts";
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
  return address.trim().toLowerCase();
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
      /**
       * Plan value credited for this payment, in cents. On-chain transfers for
       * an order carry a unique sub-cent nonce, so this is the *floored* value
       * and deliberately excludes the nonce dust.
       */
      valueMinor: number;
      /** Exact on-chain total observed, in 6-decimal USDC base units. */
      valueOnchain: string;
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

/**
 * Distinguishes "the node said this object does not exist" from "we could not
 * ask the node". Collapsing both to `null` made every RPC outage look like a
 * permanently missing transaction, and made a missing block height look like
 * a fully-confirmed one.
 */
type RpcOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: "unreachable" | "http_error" | "rpc_error" | "malformed" };

const RPC_UNAVAILABLE: RpcOutcome = { ok: false, reason: "unreachable" };

async function rpcCall(settings: UsdcSettings, method: string, params: unknown[]): Promise<RpcOutcome> {
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
    return RPC_UNAVAILABLE;
  }
  if (!res.ok) return { ok: false, reason: "http_error" };
  let json: { result?: unknown; error?: unknown };
  try {
    json = (await res.json()) as { result?: unknown; error?: unknown };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (json.error !== undefined && json.error !== null) return { ok: false, reason: "rpc_error" };
  return { ok: true, result: json.result ?? null };
}

function rpcUnavailable(method: string, outcome: RpcOutcome & { ok: false }): UsdcVerificationResult {
  return {
    ok: false,
    code: "rpc_unavailable",
    detail: `Base RPC call ${method} failed (${outcome.reason}); the chain state is unknown, so verification is retried rather than failed permanently`,
  };
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
 * Verify that `transactionHash` paid exactly `expectedOnchain` base units of
 * USDC to the configured Baton USDC wallet, on the Base network.
 *
 * `expectedOnchain` is the order's *unique* on-chain amount (plan price plus a
 * per-order sub-cent nonce, see `newUsdcOrderNonce` in payments.ts). Matching on the exact
 * amount — not just "at least the price" — is what binds a transfer to one
 * order: a transaction can only ever satisfy the single order that was issued
 * that precise figure, so a public transfer cannot be re-pointed at somebody
 * else's pending order.
 */
export async function verifyUsdcTransaction(
  settings: UsdcSettings,
  transactionHash: string,
  expectedOnchain: bigint,
): Promise<UsdcVerificationResult> {
  if (!isValidTransactionHash(transactionHash)) {
    return { ok: false, code: "invalid_hash", detail: "transaction hash does not look like a Base transaction hash" };
  }

  const txOutcome = await rpcCall(settings, "eth_getTransactionByHash", [transactionHash]);
  if (!txOutcome.ok) return rpcUnavailable("eth_getTransactionByHash", txOutcome);
  const tx = txOutcome.result as Record<string, unknown> | null;
  if (!tx || typeof tx !== "object" || tx.hash === null || tx.hash === undefined) {
    return { ok: false, code: "not_found", detail: "transaction does not exist on this network" };
  }
  if (!tx.blockNumber) {
    return { ok: false, code: "not_mined", detail: "transaction has not been mined yet" };
  }

  const receiptOutcome = await rpcCall(settings, "eth_getTransactionReceipt", [transactionHash]);
  if (!receiptOutcome.ok) return rpcUnavailable("eth_getTransactionReceipt", receiptOutcome);
  const receipt = receiptOutcome.result as Record<string, unknown> | null;
  if (!receipt || typeof receipt !== "object") {
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

  // Floor to whole cents for the credited plan value. Orders carry a sub-cent
  // nonce in the on-chain amount, so an exact `usdcOnchainToMinor` conversion
  // would reject every legitimate transfer.
  const valueMinor = Number(totalValue / ONCHAIN_UNITS_PER_CENT);

  // Exact, in both directions, and deliberately with no tolerance knob.
  //
  // The whole attribution guarantee rests on "this transfer's amount is this
  // order's amount and no other open order's", and each order's amount is unique
  // by its sub-cent nonce. A tolerance of even one cent means a single transfer
  // can satisfy several open orders at once: an attacker opens the cheapest
  // order, pays it with the difference folded in, and the same transfer now also
  // covers every order priced within the window. Underpayment is rejected for
  // the same reason in reverse. The nonce is at most 0.009999 USDC, so requiring
  // an exact figure costs a real payer nothing they would have sent anyway.
  if (totalValue !== expectedOnchain) {
    return {
      ok: false,
      code: "amount_mismatch",
      detail: `this order expects exactly ${expectedOnchain} on-chain USDC units, received ${totalValue}`,
    };
  }

  const txBlock = hexToNumber(tx.blockNumber);
  const currentBlockOutcome = await rpcCall(settings, "eth_blockNumber", []);
  const currentBlock = currentBlockOutcome.ok ? hexToNumber(currentBlockOutcome.result) : null;
  if (txBlock === null) {
    return { ok: false, code: "not_mined", detail: "transaction has no usable block height" };
  }
  // Fail closed: if the head height is unknown, confirmations are unknown, and
  // treating unknown as zero would let a reorg-fresh transaction settle.
  if (currentBlock === null) {
    return {
      ok: false,
      code: "insufficient_finality",
      detail: currentBlockOutcome.ok
        ? "Base RPC returned an unusable block height; cannot confirm finality"
        : `Base RPC block height unavailable (${currentBlockOutcome.reason}); cannot confirm finality`,
    };
  }

  const confirmations = Math.max(0, currentBlock - txBlock + 1);
  if (confirmations < settings.minConfirmations) {
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
    valueOnchain: totalValue.toString(),
    blockNumber: txBlock,
    confirmations,
    network: settings.network,
    token: settings.token,
  };
}
