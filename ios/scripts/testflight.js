// Builds the iPhone app and ships it to TestFlight with its "What to Test" notes.
//
// iOS releases are GitHub releases tagged ios-vX.Y.Z (ios/README.md). Publishing one runs
// .github/workflows/ios-release.yml, which calls this with the tag's version and the
// release notes. Merging PRs never ships the app, and PRs never bump its version:
//
//   node ios/scripts/testflight.js --version 1.1.0 --notes-file notes.md             # build, upload, set notes, wait
//   node ios/scripts/testflight.js --version 1.1.0 --notes-file notes.md --dry-run   # build and sign only
//   node ios/scripts/testflight.js --version 1.1.0 --notes-file notes.md --notes-only # re-set notes on 1.1.0's latest build
//
// --group "Public beta" also adds the build to that TestFlight group once it's processed,
// and submits it for Beta App Review when the group is external.
//
// The marketing version comes from the tag; the build number is one more than the highest
// App Store Connect already has, so two releases can never collide. The bundle ID and team
// come from Config/Local.xcconfig, as for any local build (the workflow writes one).
//
// Needs an App Store Connect API key: ASC_KEY_ID and ASC_ISSUER_ID in the environment, and
// the key file at ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8 (or ASC_KEY_PATH).
// On a Mac, Xcode's signed-in account does the signing; the workflow passes --app-profile
// and --widgets-profile to sign with the CI certificate and profiles instead.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// This file lives in ios/scripts; xcodegen and xcodebuild run in ios/.
const ios = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.appstoreconnect.apple.com/v1";
const LOCALE = "en-US";
// App Store Connect's limit on "What to Test"
export const NOTES_MAX = 4000;
const POLL_MS = 30_000;
const WAIT_MS = 45 * 60_000;

// "1.1.0" from "1.1.0", "ios-v1.1.0" or "v1.1.0"; anything else is refused
export function releaseVersion(input) {
  const version = input.trim().replace(/^(ios-)?v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${input}" isn't a version like 1.1.0 or a tag like ios-v1.1.0.`);
  return version;
}

// One more than the highest build number App Store Connect has for the app
export function nextBuildNumber(existing) {
  const highest = existing.map((v) => Number.parseInt(v, 10)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
  return String(highest + 1);
}

// The notes as testers will see them, or an error for ones App Store Connect would refuse
export function checkNotes(text) {
  const notes = text.replace(/\r\n/g, "\n").trim();
  if (!notes) throw new Error("The release notes are empty. Say what testers should try in this build.");
  if (notes.length > NOTES_MAX) throw new Error(`What to Test is ${notes.length} characters; App Store Connect allows ${NOTES_MAX}.`);
  // App Store Connect refuses emoji in What to Test, and only after the build is uploaded
  const emoji = [...new Set(notes.match(/\p{Extended_Pictographic}/gu) ?? [])];
  if (emoji.length) throw new Error(`What to Test can't contain emoji (App Store Connect refuses them): ${emoji.join(" ")}.`);
  return notes;
}

// Bundle ID and team from an xcconfig (Config/Local.xcconfig)
export function appConfig(xcconfig) {
  const value = (key) => xcconfig.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)\\s*$`, "m"))?.[1];
  const bundleId = value("BRIDGEVIEW_BUNDLE_ID");
  const teamId = value("DEVELOPMENT_TEAM");
  if (!bundleId || !teamId) throw new Error("Config/Local.xcconfig needs BRIDGEVIEW_BUNDLE_ID and DEVELOPMENT_TEAM (ios/README.md).");
  return { bundleId, teamId };
}

export function credentials(env) {
  const keyId = env.ASC_KEY_ID?.trim();
  const issuerId = env.ASC_ISSUER_ID?.trim();
  if (!keyId || !issuerId) throw new Error("Set ASC_KEY_ID and ASC_ISSUER_ID (App Store Connect → Users and Access → Integrations).");
  const keyPath = env.ASC_KEY_PATH?.trim() || join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
  return { keyId, issuerId, keyPath };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

// A short-lived App Store Connect token (Apple allows at most 20 minutes); a fresh one per request
export function token({ keyId, issuerId }, pem, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: issuerId, iat, exp: iat + 600, aud: "appstoreconnect-v1" }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key: pem, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

// ExportOptions.plist. With `profiles` ({ bundle ID: profile name }), signs with those fixed
// files and the Apple Distribution certificate, so Xcode never creates anything in the account
export function exportOptions({ teamId, upload, profiles }) {
  const escape = (s) => s.replace(/[<&>]/g, "");
  const signing = profiles
    ? `  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>${Object.entries(profiles)
    .map(([id, name]) => `<key>${escape(id)}</key><string>${escape(name)}</string>`)
    .join("")}</dict>`
    : "  <key>signingStyle</key><string>automatic</string>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${upload ? "upload" : "export"}</string>
  <key>teamID</key><string>${escape(teamId)}</string>
${signing}
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`;
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.filter((a) => !a.endsWith(".p8")).join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: ios, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`${cmd} failed (exit ${res.status ?? res.signal}).`);
}

// Archives with the release's version and build number, then signs for App Store Connect and
// either uploads or (dry run) exports to ios/build/export.
//
// With profiles (the release workflow) it signs with fixed files: the CI Apple Distribution
// certificate in the keychain and an App Store profile for the app and for the widget. Without
// them (a Mac with Xcode signed in), Xcode's automatic signing does it, as for any local build.
// Never hand the API key to automatic signing: xcodebuild then creates a new development
// certificate in the account on every run.
function buildAndUpload({ creds, config, version, build, upload, appProfile, widgetsProfile }) {
  run("xcodegen", ["-q"]);
  const archive = [
    "archive", "-quiet", "-project", "BridgeView.xcodeproj", "-scheme", "BridgeView", "-configuration", "Release",
    "-destination", "generic/platform=iOS", "-archivePath", "build/BridgeView.xcarchive",
    `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${build}`,
  ];
  const options = join(mkdtempSync(join(tmpdir(), "bridgeview-")), "ExportOptions.plist");
  let exportAuth;
  if (appProfile) {
    archive.push(
      "CODE_SIGN_STYLE=Manual", "CODE_SIGN_IDENTITY=Apple Distribution",
      `BRIDGEVIEW_APP_PROFILE=${appProfile}`, `BRIDGEVIEW_WIDGETS_PROFILE=${widgetsProfile}`,
    );
    const profiles = { [config.bundleId]: appProfile, [`${config.bundleId}.widgets`]: widgetsProfile };
    writeFileSync(options, exportOptions({ teamId: config.teamId, upload, profiles }));
    // Only to upload: signing is all manual, so there's nothing for the key to create
    exportAuth = ["-authenticationKeyPath", creds.keyPath, "-authenticationKeyID", creds.keyId, "-authenticationKeyIssuerID", creds.issuerId];
  } else {
    archive.push("-allowProvisioningUpdates");
    writeFileSync(options, exportOptions({ teamId: config.teamId, upload }));
    exportAuth = ["-allowProvisioningUpdates"];
  }
  run("xcodebuild", archive);
  run("xcodebuild", [
    "-exportArchive", "-archivePath", "build/BridgeView.xcarchive", "-exportOptionsPlist", options,
    "-exportPath", "build/export", ...exportAuth,
  ]);
}

function connect(creds) {
  const pem = readFileSync(creds.keyPath, "utf8");
  return async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token(creds, pem)}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const errors = (await res.json().catch(() => null))?.errors;
      const why = errors?.map((e) => e.detail ?? e.title).join("; ") || res.statusText;
      throw new Error(`App Store Connect ${method} ${path.split("?")[0]}: ${res.status} ${why}`);
    }
    return res.status === 204 ? null : res.json();
  };
}

async function builds(api, appId, version) {
  const q = new URLSearchParams({ "filter[app]": appId, "fields[builds]": "version,processingState,uploadedDate", limit: "200" });
  if (version) q.set("filter[preReleaseVersion.version]", version);
  return (await api(`/builds?${q}`)).data;
}

async function findBuild(api, appId, version, build) {
  return (await builds(api, appId, version)).find((b) => b.attributes.version === build) ?? null;
}

// Polls until `ready` says the build is there, or gives up
async function waitFor(what, poll, ready) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const b = await poll();
    if (b && ["FAILED", "INVALID"].includes(b.attributes.processingState)) {
      throw new Error(`Apple marked the build ${b.attributes.processingState}. Check your email from App Store Connect.`);
    }
    if (b && ready(b)) return b;
    if (Date.now() > until) throw new Error(`Gave up waiting for ${what} after ${WAIT_MS / 60_000} minutes.`);
    console.log(`  waiting for ${what}…`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Sets the notes in every language the build has, so testers see them whatever their phone's
// language. App Store Connect adds the app's primary language itself; en-US only when there's none.
async function setNotes(api, buildId, notes) {
  const { data } = await api(`/builds/${buildId}/betaBuildLocalizations`);
  for (const existing of data) {
    await api(`/betaBuildLocalizations/${existing.id}`, {
      method: "PATCH",
      body: { data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew: notes } } },
    });
  }
  if (data.length === 0) {
    await api("/betaBuildLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale: LOCALE, whatsNew: notes },
          relationships: { build: { data: { type: "builds", id: buildId } } },
        },
      },
    });
  }
}

// Adds the build to a TestFlight group; an external group's testers get it once Beta App
// Review approves it (later builds of a version usually go through at once)
async function shareWithGroup(api, appId, buildId, name) {
  const q = new URLSearchParams({ "filter[app]": appId, "filter[name]": name, "fields[betaGroups]": "name,isInternalGroup" });
  const group = (await api(`/betaGroups?${q}`)).data.find((g) => g.attributes.name === name);
  if (!group) throw new Error(`No TestFlight group named "${name}".`);
  await api(`/betaGroups/${group.id}/relationships/builds`, { method: "POST", body: { data: [{ type: "builds", id: buildId }] } });
  console.log(`✓ Added to "${name}".`);
  if (group.attributes.isInternalGroup) return;
  await api("/betaAppReviewSubmissions", {
    method: "POST",
    body: { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: buildId } } } } },
  });
  console.log("✓ Submitted for Beta App Review.");
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      "notes-file": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "notes-only": { type: "boolean", default: false },
      "app-profile": { type: "string" },
      "widgets-profile": { type: "string" },
      group: { type: "string" },
    },
  });
  if (!values.version || !values["notes-file"]) {
    throw new Error("Usage: --version 1.1.0 --notes-file notes.md [--app-profile NAME --widgets-profile NAME] [--group NAME] [--dry-run | --notes-only]");
  }
  if (Boolean(values["app-profile"]) !== Boolean(values["widgets-profile"])) {
    throw new Error("Pass both --app-profile and --widgets-profile, or neither.");
  }
  const version = releaseVersion(values.version);
  const notes = checkNotes(readFileSync(values["notes-file"], "utf8"));
  const configFile = join(ios, "Config", "Local.xcconfig");
  if (!existsSync(configFile)) throw new Error("No Config/Local.xcconfig (ios/README.md).");
  const config = appConfig(readFileSync(configFile, "utf8"));
  // Check the key before a several-minute archive, not after
  const creds = credentials(process.env);
  if (!existsSync(creds.keyPath)) throw new Error(`No App Store Connect key at ${creds.keyPath}.`);
  const api = connect(creds);
  const appId = (await api(`/apps?filter[bundleId]=${encodeURIComponent(config.bundleId)}`)).data[0]?.id;
  if (!appId) throw new Error(`No App Store Connect app with bundle ID ${config.bundleId}.`);

  let build;
  if (values["notes-only"]) {
    const latest = (await builds(api, appId, version)).sort((a, b) => Number(b.attributes.version) - Number(a.attributes.version))[0];
    if (!latest) throw new Error(`No ${version} build in App Store Connect yet.`);
    build = latest.attributes.version;
  } else {
    build = nextBuildNumber((await builds(api, appId)).map((b) => b.attributes.version));
    console.log(`BridgeView ${version} (${build}). What to Test:\n\n${notes}\n`);
    buildAndUpload({
      creds, config, version, build, upload: !values["dry-run"],
      appProfile: values["app-profile"], widgetsProfile: values["widgets-profile"],
    });
    if (values["dry-run"]) {
      console.log(`\n✓ Dry run: ${version} (${build}) built and signed in ios/build/export. Nothing uploaded.`);
      return;
    }
  }

  const poll = () => findBuild(api, appId, version, build);
  // Set the notes as soon as Apple knows about the build, so they're there before testers get it
  const found = await waitFor(`${version} (${build}) to appear`, poll, () => true);
  await setNotes(api, found.id, notes);
  console.log("✓ What to Test set.");
  if (values["notes-only"]) return;
  await waitFor("Apple to finish processing", poll, (b) => b.attributes.processingState === "VALID");
  console.log(`✓ ${version} (${build}) is ready in TestFlight.`);
  if (values.group) await shareWithGroup(api, appId, found.id, values.group);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  });
}
