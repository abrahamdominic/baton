// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PricingView } from "./pricing-view";

afterEach(cleanup);

describe("PricingView billing toggle", () => {
  it("switches the Team price between $10 monthly and $8 annual and updates the checkout link", () => {
    render(<PricingView />);

    expect(screen.getAllByText("$10").length).toBeGreaterThan(0);
    expect(screen.queryByText("$8")).toBeNull();
    const monthlyCta = screen.getByRole("link", {
      name: /start 14-day free trial \(monthly\)/i,
    });
    expect(decodeURIComponent(monthlyCta.getAttribute("href")!)).toContain("billing=monthly");

    fireEvent.click(screen.getByRole("tab", { name: /annual billing/i }));

    expect(screen.getAllByText("$8").length).toBeGreaterThan(0);
    expect(screen.queryByText("$10")).toBeNull();
    const annualCta = screen.getByRole("link", {
      name: /start 14-day free trial \(annual\)/i,
    });
    expect(decodeURIComponent(annualCta.getAttribute("href")!)).toContain("billing=annual");

    fireEvent.click(screen.getByRole("tab", { name: /monthly billing/i }));

    expect(screen.getAllByText("$10").length).toBeGreaterThan(0);
    expect(screen.queryByText("$8")).toBeNull();
  });

  it("marks the selected tab and switches Organization price between $50 monthly and $40 annual", () => {
    render(<PricingView />);

    const monthlyTab = screen.getByRole("tab", { name: /monthly billing/i });
    const annualTab = screen.getByRole("tab", { name: /annual billing/i });
    expect(monthlyTab.getAttribute("aria-selected")).toBe("true");
    expect(annualTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getAllByText("$50").length).toBeGreaterThan(0);

    fireEvent.click(annualTab);

    expect(annualTab.getAttribute("aria-selected")).toBe("true");
    expect(monthlyTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getAllByText("$40").length).toBeGreaterThan(0);
    expect(screen.queryByText("$50")).toBeNull();
  });
});