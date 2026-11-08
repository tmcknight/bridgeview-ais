import Testing
@testable import BridgeView

struct FormatTests {
    @Test func spellsOutUnitsForVoiceOver() {
        #expect(Format.spoken("Cargo · 225 m") == "Cargo, 225 metres")
        #expect(Format.spoken("225 × 24 m") == "225 by 24 metres")
        #expect(Format.spoken("1.6 NM") == "1.6 nautical miles")
        #expect(Format.spoken("11.2 kn") == "11.2 knots")
        #expect(Format.spoken("35,000 t") == "35,000 tonnes")
        #expect(Format.spoken("225 m long") == "225 metres long")
        #expect(Format.spoken("Thunder Bay") == "Thunder Bay")
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
}
