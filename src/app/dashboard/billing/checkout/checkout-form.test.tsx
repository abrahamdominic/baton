// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const push = vi.fn();
const assign = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import { CheckoutForm } from "./checkout-form";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProps = {
  plan: {
    id: "plan_team_default",
    slug: "team",
    name: "Team",
    description: "For engineering teams that want to ship fast.",
    priceCustom: false,
  },
  interval: "monthly" as const,
  amountMinor: 1500,
  planFeatures: [],
  usdcWalletAddress: "0x98f47c0000000000000000000000000000000000",
  alreadySubscribed: false,
  canRenewUsdc: false,
};

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  push.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("CheckoutForm provider availability", () => {
  // Regression: the form used to initialise to the "usdc_order" step whenever
  // Stripe was unavailable. That step only renders once a server-issued order
  // exists, so a USDC-only deployment rendered the order summary and NOTHING
  // else - no pay button, no error, no way to buy a plan.
  it("still offers the USDC button when Stripe is not configured", () => {
    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: true }} />);

    const usdc = screen.getByRole("button", { name: /pay with usdc/i });
    expect(usdc).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay with credit card/i })).toBeNull();
    // A single remaining provider must not look like a missing option.
    expect(screen.getByText(/card checkout is not enabled/i)).toBeTruthy();
  });

  it("offers both payment methods when both providers are configured", () => {
    render(<CheckoutForm {...baseProps} providers={{ stripe: true, usdc: true }} />);

    expect(screen.getByRole("button", { name: /pay with credit card/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /pay with usdc/i })).toBeTruthy();
  });

  it("offers card checkout when only Stripe is configured", () => {
    render(<CheckoutForm {...baseProps} providers={{ stripe: true, usdc: false }} />);

    expect(screen.getByRole("button", { name: /pay with credit card/i })).toBeTruthy();
    expect(screen.getByText(/usdc payments are not enabled/i)).toBeTruthy();
  });

  it("explains itself instead of rendering a dead end when no provider is available", () => {
    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: false }} />);

    expect(screen.getByText(/no payment method is currently available/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay with/i })).toBeNull();
  });
});

describe("CheckoutForm USDC order flow", () => {
  it("creates a server order and shows the exact amount to send", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      mockFetchOnce({
        provider: "usdc",
        paymentId: "pay_123",
        amountMinor: 1500,
        walletAddress: baseProps.usdcWalletAddress,
        network: "base",
        token: "USDC",
        txSubmitted: false,
        renewal: false,
      }),
    );

    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /pay with usdc/i }));

    const order = await screen.findByTestId("usdc-order");
    // Team monthly is $15 -> 1500 minor units. The order must render the
    // server-issued amount, not a locally recomputed one.
    expect(order.textContent).toContain("15.00 USDC");
    expect(order.textContent).toContain(baseProps.usdcWalletAddress);

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/billing/checkout");
    expect(JSON.parse(call[1].body)).toEqual({
      planId: "plan_team_default",
      billing: "monthly",
      provider: "usdc",
    });
  });

  it("returns to the provider chooser from the USDC order screen", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      mockFetchOnce({
        paymentId: "pay_123",
        amountMinor: 1500,
        walletAddress: baseProps.usdcWalletAddress,
        network: "base",
        token: "USDC",
      }),
    );

    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /pay with usdc/i }));
    await screen.findByTestId("usdc-order");

    fireEvent.click(screen.getByRole("button", { name: /back to payment options/i }));
    expect(screen.queryByTestId("usdc-order")).toBeNull();
    expect(screen.getByRole("button", { name: /pay with usdc/i })).toBeTruthy();
  });

  it("surfaces a server error instead of silently doing nothing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      mockFetchOnce({ error: "That plan does not exist or is no longer available." }, false),
    );

    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /pay with usdc/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no longer available");
    // The chooser must still be usable so the user can retry.
    expect(screen.getByRole("button", { name: /pay with usdc/i })).toBeTruthy();
  });
});

describe("CheckoutForm renewal", () => {
  // Regression: the USDC renewal state returned early after promising "Pay
  // again below", so an active subscriber had no way to extend their plan.
  it("shows the renewal notice and still offers a way to pay", () => {
    render(
      <CheckoutForm
        {...baseProps}
        providers={{ stripe: false, usdc: true }}
        canRenewUsdc
      />,
    );

    expect(screen.getByText(/doesn.t auto-renew/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /pay with usdc/i })).toBeTruthy();
  });

  it("does not offer a second purchase to an already-subscribed card customer", () => {
    render(
      <CheckoutForm
        {...baseProps}
        providers={{ stripe: true, usdc: true }}
        alreadySubscribed
      />,
    );

    expect(screen.getByText(/you already have access to team/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pay with/i })).toBeNull();
  });
});

describe("CheckoutForm order summary", () => {
  it("renders the server-authoritative amount for the selected interval", () => {
    const { unmount } = render(
      <CheckoutForm {...baseProps} providers={{ stripe: true, usdc: true }} />,
    );
    expect(screen.getByText("$15.00")).toBeTruthy();
    expect(screen.getByText(/\/month/)).toBeTruthy();
    unmount();

    render(
      <CheckoutForm
        {...baseProps}
        interval="annual"
        amountMinor={15000}
        providers={{ stripe: true, usdc: true }}
      />,
    );
    expect(screen.getByText("$150.00")).toBeTruthy();
    expect(screen.getByText(/\/year/)).toBeTruthy();
  });

  it("disables self-serve payment for a custom-priced plan", () => {
    render(
      <CheckoutForm
        {...baseProps}
        plan={{ ...baseProps.plan, priceCustom: true }}
        amountMinor={0}
        providers={{ stripe: true, usdc: true }}
      />,
    );

    const stripe = screen.getByRole("button", { name: /pay with credit card/i });
    expect((stripe as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/custom-priced/i)).toBeTruthy();
  });

  it("blocks submission until a plausible transaction hash is entered", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      mockFetchOnce({
        paymentId: "pay_123",
        amountMinor: 1500,
        walletAddress: baseProps.usdcWalletAddress,
        network: "base",
        token: "USDC",
      }),
    );

    render(<CheckoutForm {...baseProps} providers={{ stripe: false, usdc: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /pay with usdc/i }));
    await screen.findByTestId("usdc-order");

    const submit = screen.getByRole("button", { name: /i.ve sent it, verify/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/transaction hash/i), {
      target: { value: "0xabc123def456" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /i.ve sent it, verify/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });
});
