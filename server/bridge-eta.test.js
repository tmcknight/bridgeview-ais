import { describe, it, expect } from "vitest";
import { BRIDGE_CENTER } from "./ship-log.js";
import { bridgeApproach, describeCargo, flagForMmsi, shipCategory, shipTypeName } from "./bridge-eta.js";

const north = (nm) => BRIDGE_CENTER.lat + nm / 60;

function at(nm, { sog = 12, cog = 0, navStatus = 0, destination } = {}) {
  return { latitude: north(nm), longitude: BRIDGE_CENTER.lng, sog, cog, navStatus, destination };
}

describe("bridgeApproach", () => {
  it("times a downbound ship by straight-line distance", () => {
    const approach = bridgeApproach(at(2, { cog: 180 }));
    expect(approach.direction).toBe("downbound");
    expect(approach.distanceNM).toBeCloseTo(2, 2);
    expect(approach.etaMinutes).toBeCloseTo(10, 1);
  });

  it("allows for the river route from the south", () => {
    const approach = bridgeApproach(at(-2, { cog: 0 }));
    expect(approach.direction).toBe("upbound");
    expect(approach.distanceNM).toBeCloseTo(2.4, 2);
  });

  it("ignores ships heading away, crossing, stopped, moored or without a course", () => {
    expect(bridgeApproach(at(2, { cog: 0 }))).toBeNull();
    expect(bridgeApproach(at(2, { cog: 90 }))).toBeNull();
    expect(bridgeApproach(at(2, { cog: 180, sog: 0.2 }))).toBeNull();
    expect(bridgeApproach(at(2, { cog: 180, sog: 102.3 }))).toBeNull();
    expect(bridgeApproach(at(2, { cog: 180, navStatus: 5 }))).toBeNull();
    expect(bridgeApproach(at(2, { cog: 360 }))).toBeNull();
  });

  it("ignores northbound ships stopping south of the bridge", () => {
    expect(bridgeApproach(at(-2, { destination: "Sarnia" }))).toBeNull();
  });
});

describe("ship facts", () => {
  it("guesses cargo from the destination", () => {
    const laker = { shipType: 70, length: 225 };
    expect(describeCargo({ ...laker, destination: "THUNDER BAY" })).toBe("Likely going to load grain");
    expect(describeCargo({ ...laker, destination: "zug island" })).toBe("Likely delivering iron ore or coal");
    expect(describeCargo({ ...laker, destination: "TOLEDO" })).toBeUndefined();
    expect(describeCargo({ ...laker, destination: undefined })).toBeUndefined();
    expect(describeCargo()).toBeUndefined();
  });

  it("guesses cargo only for cargo ships and tankers of 100 m or more", () => {
    const destination = "DULUTH";
    expect(describeCargo({ destination, shipType: 84, length: 100 })).toBe("Likely going to load iron ore");
    expect(describeCargo({ destination, shipType: 70, length: 99 })).toBeUndefined();
    expect(describeCargo({ destination, shipType: 70 })).toBeUndefined();
    expect(describeCargo({ destination, shipType: 52, length: 225 })).toBeUndefined();
    expect(describeCargo({ destination, length: 225 })).toBeUndefined();
  });

  it("groups AIS ship types", () => {
    expect(shipCategory(70)).toBe("cargo");
    expect(shipCategory(84)).toBe("tanker");
    expect(shipCategory(60)).toBe("passenger");
    expect(shipCategory(52)).toBe("other");
    expect(shipCategory(undefined)).toBe("other");
    expect(shipTypeName(79)).toBe("Cargo");
    expect(shipTypeName(52)).toBe("Tug");
    expect(shipTypeName(undefined)).toBeUndefined();
  });

  it("reads the flag from the MMSI", () => {
    expect(flagForMmsi(316001234)).toBe("CA");
    expect(flagForMmsi(367123456)).toBe("US");
    expect(flagForMmsi(999000000)).toBeUndefined();
  });
});
