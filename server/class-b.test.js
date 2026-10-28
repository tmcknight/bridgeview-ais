import { describe, it, expect } from "vitest";
import { fromAISStreamClassB, withClassBTypes } from "./class-b.js";

const META = {
  MMSI: 367000001,
  MMSI_String: "367000001",
  ShipName: "",
  latitude: 42.99,
  longitude: -82.42,
  time_utc: "2026-10-28 15:00:00.000000000 +0000 UTC",
};

const standardPosition = {
  MessageType: "StandardClassBPositionReport",
  MetaData: META,
  Message: {
    StandardClassBPositionReport: {
      MessageID: 18,
      RepeatIndicator: 0,
      UserID: 367000001,
      Valid: true,
      Sog: 6.2,
      PositionAccuracy: true,
      Longitude: -82.42,
      Latitude: 42.99,
      Cog: 12.3,
      TrueHeading: 511,
      Timestamp: 30,
      Raim: false,
      ClassBUnit: true,
    },
  },
};

function staticReport(partB, report) {
  return {
    MessageType: "StaticDataReport",
    MetaData: META,
    Message: {
      StaticDataReport: {
        MessageID: 24,
        UserID: 367000001,
        Valid: true,
        PartNumber: partB,
        ReportA: { Valid: !partB, Name: partB ? "" : report.Name },
        ReportB: {
          Valid: partB,
          ShipType: report.ShipType ?? 0,
          CallSign: report.CallSign ?? "",
          Dimension: report.Dimension ?? { A: 0, B: 0, C: 0, D: 0 },
        },
      },
    },
  };
}

describe("withClassBTypes", () => {
  it("adds the Class B messages for the Class A ones asked for", () => {
    expect(
      withClassBTypes({ BoundingBoxes: [], FilterMessageTypes: ["PositionReport", "ShipStaticData"] })
        .FilterMessageTypes
    ).toEqual([
      "ExtendedClassBPositionReport",
      "PositionReport",
      "ShipStaticData",
      "StandardClassBPositionReport",
      "StaticDataReport",
    ]);
    expect(withClassBTypes({ BoundingBoxes: [], FilterMessageTypes: ["ShipStaticData"] }).FilterMessageTypes)
      .toEqual(["ShipStaticData", "StaticDataReport"]);
  });

  it("leaves subscriptions with no type filter, and no subscription, alone", () => {
    expect(withClassBTypes({ BoundingBoxes: [] })).toEqual({ BoundingBoxes: [] });
    expect(withClassBTypes(null)).toBeNull();
  });
});

describe("fromAISStreamClassB", () => {
  it("turns a Class B position report into a PositionReport marked Class B", () => {
    const msg = fromAISStreamClassB(standardPosition, new Map());

    expect(msg.MessageType).toBe("PositionReport");
    expect(msg.MetaData).toMatchObject({ MMSI: 367000001, AisClass: "B" });
    expect(msg.Message.PositionReport).toMatchObject({
      MessageID: 18,
      Latitude: 42.99,
      Longitude: -82.42,
      Sog: 6.2,
      Cog: 12.3,
      TrueHeading: 511,
      NavigationalStatus: 15,
      UserID: 367000001,
    });
  });

  it("joins both parts of a static data report into one ShipStaticData", () => {
    const details = new Map();
    const partA = fromAISStreamClassB(staticReport(false, { Name: "SEA BREEZE  " }), details);
    expect(partA.MessageType).toBe("ShipStaticData");
    expect(partA.MetaData).toMatchObject({ ShipName: "SEA BREEZE", AisClass: "B" });
    expect(partA.Message.ShipStaticData).toMatchObject({ Name: "SEA BREEZE", MessageID: 24 });

    const partB = fromAISStreamClassB(
      staticReport(true, { ShipType: 37, CallSign: "WDA1234 ", Dimension: { A: 8, B: 4, C: 2, D: 2 } }),
      details
    );
    expect(partB.Message.ShipStaticData).toMatchObject({
      Name: "SEA BREEZE",
      Type: 37,
      CallSign: "WDA1234",
      Dimension: { A: 8, B: 4, C: 2, D: 2 },
      Destination: "",
      ImoNumber: 0,
    });
  });

  it("names later position reports from an extended report", () => {
    const details = new Map();
    const extended = fromAISStreamClassB(
      {
        MessageType: "ExtendedClassBPositionReport",
        MetaData: META,
        Message: {
          ExtendedClassBPositionReport: {
            ...standardPosition.Message.StandardClassBPositionReport,
            MessageID: 19,
            Name: "TUG LIFE",
            Type: 52,
            Dimension: { A: 10, B: 5, C: 3, D: 3 },
          },
        },
      },
      details
    );
    expect(extended.MetaData.ShipName).toBe("TUG LIFE");
    expect(extended.Message.PositionReport.MessageID).toBe(19);
    expect(details.get(367000001)).toMatchObject({ name: "TUG LIFE", shipType: 52 });
  });

  it("drops static reports with nothing usable and passes Class A messages through", () => {
    expect(fromAISStreamClassB(staticReport(false, { Name: "   " }), new Map())).toBeNull();

    const classA = { MessageType: "PositionReport", MetaData: META, Message: { PositionReport: {} } };
    expect(fromAISStreamClassB(classA, new Map())).toBe(classA);
  });
});
