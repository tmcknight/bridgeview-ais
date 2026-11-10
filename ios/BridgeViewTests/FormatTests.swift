import Foundation
import Testing
@testable import BridgeView

struct FormatTests {
    @Test func spellsOutUnitsForVoiceOver() {
        #expect(Format.spoken("Cargo · 225 m", locale: Locale(identifier: "en_CA")) == "Cargo, 225 metres")
        #expect(Format.spoken("225 × 24 m", locale: Locale(identifier: "en_CA")) == "225 by 24 metres")
        #expect(Format.spoken("1.6 NM") == "1.6 nautical miles")
        #expect(Format.spoken("11.2 kn") == "11.2 knots")
        #expect(Format.spoken("35,000 t") == "35,000 tonnes")
        #expect(Format.spoken("225 m long", locale: Locale(identifier: "en_CA")) == "225 metres long")
        #expect(Format.spoken("Thunder Bay") == "Thunder Bay")
    }

    @Test func spellsUnitsTheAmericanWayInTheUS() {
        let us = Locale(identifier: "en_US")
        #expect(Format.spoken("Cargo · 225 m", locale: us) == "Cargo, 225 meters")
        #expect(Format.spoken("3.2 km", locale: us) == "3.2 kilometers")
        #expect(Format.spoken("1,014 ft", locale: us) == "1,014 feet")
        let quebec = Lengths.english(for: Locale(identifier: "fr_CA"))
        #expect(Lengths.format(1225, unit: .meters, spoken: true, locale: quebec) == "1,225 metres")
    }

    @Test func showsLengthsInTheChosenUnit() {
        let ca = Locale(identifier: "en_CA")
        let us = Locale(identifier: "en_US")
        #expect(Lengths.format(309, unit: .meters, locale: ca) == "309 m")
        #expect(Lengths.format(309, unit: .feet, locale: us) == "1,014 ft")
        #expect(Lengths.format(8.4, unit: .meters, decimals: 1, locale: ca) == "8.4 m")
        #expect(Lengths.format(8.4, unit: .feet, decimals: 1, locale: us) == "28 ft")
        #expect(Lengths.format(225, unit: .meters, spoken: true, locale: ca) == "225 metres")
        #expect(Lengths.size(length: 225, width: 24, unit: .meters, locale: ca) == "225 × 24 m")
        #expect(Lengths.size(length: 225, width: 24, unit: .feet, locale: us) == "738 × 79 ft")
    }

    @Test func automaticLengthsFollowTheMeasurementSystem() {
        #expect(LengthUnit.automatic.resolved(for: Locale(identifier: "en_US")) == .feet)
        #expect(LengthUnit.automatic.resolved(for: Locale(identifier: "en_CA")) == .meters)
        #expect(LengthUnit.automatic.resolved(for: Locale(identifier: "fr_CA")) == .meters)
        #expect(LengthUnit.metres.resolved(for: Locale(identifier: "en_US")) == .meters)
        #expect(LengthUnit.feet.serverValue(for: Locale(identifier: "en_CA")) == "ft")
    }

    /// The String Catalog: Canadian spelling as the base, American for en-US only
    @Test func spellsWordsForTheLanguage() throws {
        #expect(Bundle.preferredLocalizations(from: ["en", "en-US"], forPreferences: ["en-CA"]).first == "en")
        #expect(Bundle.preferredLocalizations(from: ["en", "en-US"], forPreferences: ["en-GB"]).first == "en")
        #expect(Bundle.preferredLocalizations(from: ["en", "en-US"], forPreferences: ["en-US"]).first == "en-US")
        // Both must be built, or an en-CA phone matches en-US as the only English
        #expect(Set(Bundle.main.localizations).isSuperset(of: ["en", "en-US"]))
        let path = try #require(Bundle.main.path(forResource: "en-US", ofType: "lproj"))
        let american = try #require(Bundle(path: path))
        #expect(american.localizedString(forKey: "Favourite", value: nil, table: nil) == "Favorite")
        #expect(american.localizedString(forKey: "Draught", value: nil, table: nil) == "Draft")
        #expect(Bundle.main.localizedString(forKey: "Favourites", value: nil, table: nil).hasPrefix("Favo"))
    }

    @Test func speaksMinutesInWords() {
        #expect(Format.spokenMinutes(0.2) == "now")
        #expect(Format.spokenMinutes(12) == "12 minutes")
        #expect(Format.spokenMinutes(65).contains("hour"))
    }

    @Test func describesCourseFromTheWayThePhonePoints() {
        #expect(Format.spokenCourse(20) == "heading north-northeast")
        #expect(Format.spokenCourse(359, compassHeading: 2) == "heading north, the way you're facing")
        #expect(Format.spokenCourse(90, compassHeading: 0) == "heading east, 90 degrees right of the way you're facing")
        #expect(Format.spokenCourse(300, compassHeading: 0) == "heading west-northwest, 60 degrees left of the way you're facing")
        #expect(Format.spokenCourse(180, compassHeading: 0) == "heading south, opposite the way you're facing")
    }

    @Test func offersNearBridgeDistancesInTheUnitSystem() throws {
        #expect(NearBridgeRadius.usOptions == [1_609, 4_828, 8_047, 24_140])
        #expect(NearBridgeRadius.nearest(5_000, unit: .feet) == 4_828)
        #expect(NearBridgeRadius.nearest(4_828, unit: .meters) == 5_000)
        #expect(NearBridgeRadius.nearest(25_000, unit: .feet) == 24_140)
        let ca = Locale(identifier: "en_CA")
        #expect(NearBridgeRadius.label(5_000, unit: .meters, locale: ca) == "5 km")
        #expect(NearBridgeRadius.label(4_828, unit: .feet, locale: Locale(identifier: "en_US")) == "3 mi")

        let defaults = try #require(UserDefaults(suiteName: "NearBridgeRadius-\(UUID())"))
        #expect(NearBridgeRadius.stored(in: defaults) == 5_000)
        defaults.set(10, forKey: NearBridgeRadius.legacyKey)
        #expect(NearBridgeRadius.stored(in: defaults) == 10_000)
        defaults.set(1_609, forKey: NearBridgeRadius.key)
        #expect(NearBridgeRadius.stored(in: defaults) == 1_609)
    }
}
