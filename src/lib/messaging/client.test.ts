// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { forgetDevice } from "./client";

vi.mock("@/app/dashboard/team/[teamId]/messaging/actions", () => ({
  registerDeviceKeyAction: vi.fn(),
}));

function makeStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("forgetDevice", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
  });

  it("removes only the signed-out account's key", () => {
    window.localStorage.setItem("baton:msg:device:user-1", JSON.stringify({ privateKeyB64: "k1" }));
    window.localStorage.setItem("baton:msg:device:user-2", JSON.stringify({ privateKeyB64: "k2" }));

    forgetDevice("user-1");

    expect(window.localStorage.getItem("baton:msg:device:user-1")).toBeNull();
    expect(window.localStorage.getItem("baton:msg:device:user-2")).not.toBeNull();
  });

  it("sweeps every stored device key when the user is unknown", () => {
    window.localStorage.setItem("baton:msg:device:user-1", "{}");
    window.localStorage.setItem("baton:msg:device:user-2", "{}");
    window.localStorage.setItem("baton:theme", "dark");

    forgetDevice();

    expect(window.localStorage.getItem("baton:msg:device:user-1")).toBeNull();
    expect(window.localStorage.getItem("baton:msg:device:user-2")).toBeNull();
    // Unrelated preferences must survive.
    expect(window.localStorage.getItem("baton:theme")).toBe("dark");
  });

  it("does not throw when storage is unavailable", () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("denied");
      },
      configurable: true,
    });
    expect(() => forgetDevice("user-1")).not.toThrow();
  });
});

