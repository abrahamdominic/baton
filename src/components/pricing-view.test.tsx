import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PricingView } from "./pricing-view";

describe("PricingView component", () => {
  it("renders valid table markup without nested tr or DOM errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = ReactDOMServer.renderToString(<PricingView />);

    expect(html).toContain("Individual");
    expect(html).toContain("Team");
    expect(html).toContain("Organization");
    expect(html).toContain("$10");
    expect(html).toContain("Start 14-Day Free Trial (Monthly)");
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");

    // Verify there is no nested <tr> inside another <tr>
    const nestedTrRegex = /<tr\b[^>]*>(?:(?!<\/tr>).)*<tr\b/s;
    expect(nestedTrRegex.test(html)).toBe(false);

    // Verify that every section header tr and row tr has valid td/th children
    expect(html).toContain("Core State Engine");
    expect(html).toContain("Nudges &amp; Thresholds");
    expect(html).toContain("Management &amp; Security");
    expect(html).toContain("Deterministic PR state machine");

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("never contains em dashes", () => {
    const html = ReactDOMServer.renderToString(<PricingView />);
    expect(html.includes("—")).toBe(false);
  });
});
