// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PricingView } from "./pricing-view";

afterEach(cleanup);

describe("PricingView billing toggle", () => {
  it("switches the Team price between $15 monthly and $150 annual and updates the checkout link", () => {
    render(<PricingView />);

    expect(screen.getAllByText("$15").length).toBeGreaterThan(0);
    expect(screen.queryByText("$150")).toBeNull();
    const monthlyCta = screen.getByRole("link", {
      name: /start 14-day free trial \(monthly\)/i,
    });
    expect(decodeURIComponent(monthlyCta.getAttribute("href")!)).toContain("billing=monthly");

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));

    expect(screen.getAllByText("$150").length).toBeGreaterThan(0);
    expect(screen.queryByText("$15")).toBeNull();
    const annualCta = screen.getByRole("link", {
      name: /start 14-day free trial \(annual\)/i,
    });
    expect(decodeURIComponent(annualCta.getAttribute("href")!)).toContain("billing=annual");

    fireEvent.click(screen.getByRole("tab", { name: /monthly billing/i }));

    expect(screen.getAllByText("$15").length).toBeGreaterThan(0);
    expect(screen.queryByText("$150")).toBeNull();
  });

  it("marks the selected tab and switches Organization price between $49 monthly and $490 annual", () => {
    render(<PricingView />);

    const monthlyTab = screen.getByRole("tab", { name: /monthly billing/i });
    const annualTab = screen.getByRole("tab", { name: /annual billing/i });
    expect(monthlyTab.getAttribute("aria-selected")).toBe("true");
    expect(annualTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$49").length).toBeGreaterThan(0);

    fireEvent.click(annualTab);

    expect(annualTab.getAttribute("aria-selected")).toBe("true");
    expect(monthlyTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.getAllByText("$0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$490").length).toBeGreaterThan(0);
    expect(screen.queryByText("$49")).toBeNull();
  });
  it("prices the free comparison column at $0 forever, not 'Custom'", () => {
    render(<PricingView />);

    // The free column has no `plans` row, so the header derived its price from a
    // null plan. That branch returned "Custom", which rendered the public
    // pricing table as "Custom free forever" - implying a sales conversation
    // for a plan that costs nothing.
    const freeHeader = screen.getByRole("columnheader", { name: /free/i });
    expect(freeHeader.textContent).toContain("$0");
    expect(freeHeader.textContent).toContain("forever");
    expect(freeHeader.textContent).not.toContain("Custom");

    // Switching billing interval must not change the free tier's price.
    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));
    const annualFreeHeader = screen.getByRole("columnheader", { name: /free/i });
    expect(annualFreeHeader.textContent).toContain("$0");
    expect(annualFreeHeader.textContent).toContain("forever");
    expect(annualFreeHeader.textContent).not.toContain("Custom");
  });
});
