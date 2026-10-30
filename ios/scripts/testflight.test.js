import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { appConfig, checkNotes, credentials, exportOptions, nextBuildNumber, NOTES_MAX, releaseVersion, token } from "./testflight.js";

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("TestFlight upload script", () => {
  it("takes the version from the release tag", () => {
    expect(releaseVersion("ios-v1.1.0")).toBe("1.1.0");
    expect(releaseVersion("v1.2.3")).toBe("1.2.3");
    expect(releaseVersion(" 1.0.0 ")).toBe("1.0.0");
    for (const bad of ["v2.34.0-beta", "ios-1.1", "latest", ""]) expect(() => releaseVersion(bad)).toThrow();
  });

  it("numbers each build one past the highest App Store Connect has", () => {
    expect(nextBuildNumber(["1", "2", "10", "9"])).toBe("11"); // numbers, not strings: 10 > 9
    expect(nextBuildNumber([])).toBe("1");
  });

  it("trims the notes and refuses ones App Store Connect would", () => {
    expect(checkNotes("\r\n  Try the alerts.\r\n")).toBe("Try the alerts.");
    expect(() => checkNotes("  \n")).toThrow(/empty/);
    expect(() => checkNotes("x".repeat(NOTES_MAX + 1))).toThrow(/4000/);
    expect(() => checkNotes("New: 🚢 Live Activities.")).toThrow(/emoji.*🚢/);
    expect(checkNotes("Upbound — toward Lake Huron.")).toBe("Upbound — toward Lake Huron.");
  });

  it("reads the bundle ID and team from Local.xcconfig", () => {
    const xcconfig = "// mine\nBRIDGEVIEW_BUNDLE_ID = com.example.ships\nDEVELOPMENT_TEAM = ABCDE12345\nBRIDGEVIEW_API_URL = https:/$()/x\n";
    expect(appConfig(xcconfig)).toEqual({ bundleId: "com.example.ships", teamId: "ABCDE12345" });
    expect(() => appConfig("DEVELOPMENT_TEAM =\n")).toThrow(/BRIDGEVIEW_BUNDLE_ID/);
  });

  it("signs CI builds with the fixed profiles, never letting Xcode choose", () => {
    const profiles = { "com.example.ships": "BridgeView CI App Store", "com.example.ships.widgets": "BridgeView CI Widgets" };
    const plist = exportOptions({ teamId: "ABCDE12345", upload: true, profiles });
    expect(plist).toContain("<key>signingStyle</key><string>manual</string>");
    expect(plist).toContain("<key>com.example.ships</key><string>BridgeView CI App Store</string>");
    expect(plist).toContain("<key>com.example.ships.widgets</key><string>BridgeView CI Widgets</string>");
    expect(plist).toContain("<key>destination</key><string>upload</string>");
    const local = exportOptions({ teamId: "ABCDE12345", upload: false });
    expect(local).toContain("<key>signingStyle</key><string>automatic</string>");
    expect(local).toContain("<key>destination</key><string>export</string>");
  });

  it("finds the key where Apple's tools keep it, unless told otherwise", () => {
    expect(credentials({ ASC_KEY_ID: "ABC123", ASC_ISSUER_ID: "issuer" }).keyPath).toMatch(/\.appstoreconnect\/private_keys\/AuthKey_ABC123\.p8$/);
    expect(credentials({ ASC_KEY_ID: "ABC123", ASC_ISSUER_ID: "issuer", ASC_KEY_PATH: "/k.p8" }).keyPath).toBe("/k.p8");
    expect(() => credentials({ ASC_KEY_ID: "ABC123" })).toThrow(/ASC_ISSUER_ID/);
  });

  it("signs tokens the way App Store Connect expects", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const jwt = token({ keyId: "ABC123", issuerId: "issuer" }, pem, Date.parse("2026-10-30T12:00:00Z"));
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "ABC123", typ: "JWT" });
    const c = decode(claims);
    expect(c.iss).toBe("issuer");
    expect(c.aud).toBe("appstoreconnect-v1");
    expect(c.exp - c.iat).toBeLessThanOrEqual(20 * 60);
    const valid = crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);
  });
});
