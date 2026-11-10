import { describe, expect, it } from "vitest";
import { parseClientMessage, tokenMatches, validateSubscription } from "./subscription.js";

const BOX = [[42.5, -82.8], [43.4, -82.1]];

describe("validateSubscription", () => {
  it("accepts a subscription and keeps only the fields the server uses", () => {
    const result = validateSubscription({
      BoundingBoxes: [BOX],
      FilterMessageTypes: ["PositionReport", "ShipStaticData", "PositionReport"],
      Apikey: "someone else's",
    });
    expect(result).toEqual({
      valid: true,
      subscription: { BoundingBoxes: [BOX], FilterMessageTypes: ["PositionReport", "ShipStaticData"] },
    });
  });

  it("accepts a subscription with no type filter", () => {
    expect(validateSubscription({ BoundingBoxes: [BOX] })).toEqual({
      valid: true,
      subscription: { BoundingBoxes: [BOX] },
    });
  });

  it.each([
    ["null", null],
    ["a string", "subscribe"],
    ["a number", 7],
    ["no boxes", {}],
    ["boxes that aren't a list", { BoundingBoxes: "all" }],
  ])("refuses %s", (_name, message) => {
    expect(validateSubscription(message).valid).toBe(false);
  });

  // Each of these used to throw (or slip through as NaN) instead of being refused
  it.each([
    ["a flat box", [1, 2]],
    ["null corners", [null, null]],
    ["a corner that isn't a pair", [[42, -82], 5]],
    ["a corner with three numbers", [[42, -82, 0], [43, -82]]],
    ["text coordinates", [["42", "-82"], ["43", "-82"]]],
    ["NaN coordinates", [[NaN, -82], [43, -82]]],
    ["an object for a corner", [{ lat: 42, lon: -82 }, [43, -82]]],
  ])("refuses %s without throwing", (_name, box) => {
    expect(validateSubscription({ BoundingBoxes: [box] })).toEqual({
      valid: false,
      error: "Each bounding box must be an array of 2 coordinate pairs",
    });
  });

  it("refuses coordinates off the globe", () => {
    expect(validateSubscription({ BoundingBoxes: [[[91, 0], [92, 1]]] }).error).toBe("Coordinates out of valid range");
    expect(validateSubscription({ BoundingBoxes: [[[0, -181], [1, 0]]] }).error).toBe("Coordinates out of valid range");
  });

  it("refuses a box that's too big", () => {
    expect(validateSubscription({ BoundingBoxes: [[[0, 0], [20, 20]]] }).error).toMatch(/too large/);
  });

  it("refuses more than five boxes", () => {
    expect(validateSubscription({ BoundingBoxes: Array(6).fill(BOX) }).error).toMatch(/Maximum 5/);
  });

  it("refuses unknown message types", () => {
    expect(validateSubscription({ BoundingBoxes: [BOX], FilterMessageTypes: ["Everything"] }).valid).toBe(false);
    expect(validateSubscription({ BoundingBoxes: [BOX], FilterMessageTypes: [{}] }).valid).toBe(false);
    expect(validateSubscription({ BoundingBoxes: [BOX], FilterMessageTypes: "PositionReport" }).valid).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("parses JSON, from text or a buffer", () => {
    expect(parseClientMessage('{"a":1}')).toEqual({ a: 1 });
    expect(parseClientMessage(Buffer.from("null"))).toBeNull();
  });

  it("gives undefined for anything else", () => {
    expect(parseClientMessage("not json")).toBeUndefined();
  });
});

describe("tokenMatches", () => {
  it("matches only the same text", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secret2", "secret")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
  });

  it("refuses tokens that aren't text", () => {
    expect(tokenMatches(undefined, "secret")).toBe(false);
    expect(tokenMatches(["secret"], "secret")).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
