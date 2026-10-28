// Class B transponders (pleasure craft, small workboats) report with their own AIS
// messages: 18 and 19 for position, and 24, sent in two parts, for name and details.
// The app only handles Class A's PositionReport and ShipStaticData, so both feeds turn
// Class B messages into those shapes, marked with MetaData.AisClass = "B".

// AISStream's names for the Class B messages, with their AIS message numbers
export const CLASS_B_MESSAGE_IDS = {
  StandardClassBPositionReport: 18,
  ExtendedClassBPositionReport: 19,
  StaticDataReport: 24,
};

// The Class B messages to ask AISStream for alongside each Class A message
const CLASS_B_EQUIVALENTS = {
  PositionReport: ["StandardClassBPositionReport", "ExtendedClassBPositionReport"],
  ShipStaticData: ["StaticDataReport"],
};

// Most ships whose Class B details are kept while waiting for the other part
const MAX_DETAILS = 5000;

// Add the Class B messages to an AISStream subscription that asks for the Class A ones
export function withClassBTypes(subscription) {
  if (!subscription?.FilterMessageTypes) return subscription;
  const types = new Set(subscription.FilterMessageTypes);
  for (const type of subscription.FilterMessageTypes) {
    for (const extra of CLASS_B_EQUIVALENTS[type] ?? []) types.add(extra);
  }
  return { ...subscription, FilterMessageTypes: Array.from(types).sort() };
}

// Remember one part of a ship's Class B details (name from part A or a type 19 report;
// type, call sign and size from part B) and return everything known so far
export function mergeClassBDetails(details, mmsi, part) {
  const merged = { ...details.get(mmsi), ...part };
  // Re-insert so the oldest ship is first to go
  details.delete(mmsi);
  details.set(mmsi, merged);
  if (details.size > MAX_DETAILS) details.delete(details.keys().next().value);
  return merged;
}

export function classBPositionReport(metaData, report) {
  return {
    MessageType: "PositionReport",
    MetaData: { ...metaData, AisClass: "B" },
    Message: {
      PositionReport: {
        CommunicationState: 0,
        // Class B reports carry no navigational status or rate of turn
        NavigationalStatus: 15,
        RateOfTurn: -128,
        Spare: 0,
        SpecialManoeuvreIndicator: 0,
        Valid: true,
        ...report,
      },
    },
  };
}

export function classBStaticData(metaData, { name = "", shipType = 0, callSign = "", dimension } = {}) {
  const mmsi = metaData.MMSI;
  return {
    MessageType: "ShipStaticData",
    MetaData: { ...metaData, ShipName: name || metaData.ShipName || "", AisClass: "B" },
    Message: {
      ShipStaticData: {
        AisVersion: 0,
        CallSign: callSign,
        // Class B sends no destination, ETA, draught or IMO number
        Destination: "",
        Dimension: {
          A: dimension?.A ?? 0,
          B: dimension?.B ?? 0,
          C: dimension?.C ?? 0,
          D: dimension?.D ?? 0,
        },
        Draught: 0,
        Dte: false,
        Eta: { Day: 0, Hour: 24, Minute: 60, Month: 0 },
        ImoNumber: 0,
        MaximumStaticDraught: 0,
        MessageID: CLASS_B_MESSAGE_IDS.StaticDataReport,
        Name: name,
        RepeatIndicator: 0,
        Spare: false,
        Type: shipType,
        UserID: mmsi,
        Valid: true,
      },
    },
  };
}

// Turn an AISStream Class B message into a PositionReport or ShipStaticData, using
// `details` (a Map) to join the two parts of a static data report. Other messages
// pass through unchanged; returns null for a Class B message with nothing usable.
export function fromAISStreamClassB(message, details) {
  const { MessageType, MetaData, Message } = message;

  if (MessageType === "StandardClassBPositionReport" || MessageType === "ExtendedClassBPositionReport") {
    const report = Message?.[MessageType];
    if (!report) return null;
    let name = MetaData.ShipName?.trim() ?? "";
    if (MessageType === "ExtendedClassBPositionReport") {
      const known = mergeClassBDetails(details, MetaData.MMSI, {
        ...(report.Name?.trim() && { name: report.Name.trim() }),
        shipType: report.Type,
        dimension: report.Dimension,
      });
      name = known.name ?? name;
    }
    return classBPositionReport(
      { ...MetaData, ShipName: name },
      {
        Cog: report.Cog,
        Latitude: report.Latitude,
        Longitude: report.Longitude,
        MessageID: report.MessageID,
        PositionAccuracy: report.PositionAccuracy,
        Raim: report.Raim,
        RepeatIndicator: report.RepeatIndicator,
        Sog: report.Sog,
        Timestamp: report.Timestamp,
        TrueHeading: report.TrueHeading,
        UserID: report.UserID,
      }
    );
  }

  if (MessageType === "StaticDataReport") {
    const report = Message?.StaticDataReport;
    if (!report) return null;
    // PartNumber false is part A (name), true is part B (type, call sign, size)
    let part = null;
    if (!report.PartNumber && report.ReportA?.Valid && report.ReportA.Name?.trim()) {
      part = { name: report.ReportA.Name.trim() };
    } else if (report.PartNumber && report.ReportB?.Valid) {
      part = {
        shipType: report.ReportB.ShipType,
        callSign: report.ReportB.CallSign?.trim() ?? "",
        dimension: report.ReportB.Dimension,
      };
    }
    if (!part) return null;
    return classBStaticData(MetaData, mergeClassBDetails(details, MetaData.MMSI, part));
  }

  return message;
}
