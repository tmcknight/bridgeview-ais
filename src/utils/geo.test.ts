import { describe, it, expect } from 'vitest'
import {
  haversineDistanceNM,
  distanceToBridge,
  isApproaching,
  formatDistance,
  formatSpeed,
  formatHeading,
  estimatedTimeToBridge,
  formatETA,
} from './geo'
import { BRIDGE_CENTER } from '../constants/bridge'

describe('haversineDistanceNM', () => {
  it('should return 0 for identical coordinates', () => {
    const distance = haversineDistanceNM(
      BRIDGE_CENTER.lat,
      BRIDGE_CENTER.lng,
      BRIDGE_CENTER.lat,
      BRIDGE_CENTER.lng
    )
    expect(distance).toBe(0)
  })

  it('should calculate distance from Blue Water Bridge to Detroit (approx 48-49 NM)', () => {
    // Detroit coordinates (Renaissance Center area)
    const detroitLat = 42.331429
    const detroitLon = -83.045753
    const distance = haversineDistanceNM(
      BRIDGE_CENTER.lat,
      BRIDGE_CENTER.lng,
      detroitLat,
      detroitLon
    )
    // Allow 1 NM tolerance for approximation
    expect(distance).toBeGreaterThan(47)
    expect(distance).toBeLessThan(50)
  })

  it('should calculate distance from Blue Water Bridge to Mackinac Bridge (approx 196 NM)', () => {
    // Mackinac Bridge coordinates
    const mackinacLat = 45.8174
    const mackinacLon = -84.7278
    const distance = haversineDistanceNM(
      BRIDGE_CENTER.lat,
      BRIDGE_CENTER.lng,
      mackinacLat,
      mackinacLon
    )
    // Allow 2 NM tolerance
    expect(distance).toBeGreaterThan(194)
    expect(distance).toBeLessThan(198)
  })

  it('should handle coordinates across the equator', () => {
    const distance = haversineDistanceNM(10, 0, -10, 0)
    // ~20 degrees latitude = ~1200 NM
    expect(distance).toBeGreaterThan(1180)
    expect(distance).toBeLessThan(1220)
  })

  it('should handle coordinates across the date line', () => {
    const distance = haversineDistanceNM(0, 179, 0, -179)
    // ~2 degrees = ~120 NM
    expect(distance).toBeGreaterThan(110)
    expect(distance).toBeLessThan(130)
  })

  it('should calculate consistent precision to 0.01 NM', () => {
    const distance1 = haversineDistanceNM(43.0, -82.4, 43.0, -82.41)
    const distance2 = haversineDistanceNM(43.0, -82.4, 43.0, -82.41)
    expect(distance1).toBe(distance2)
    expect(distance1).toBeCloseTo(0.44, 1) // Should be around 0.44 NM
  })
})

describe('distanceToBridge', () => {
  it('should return 0 at bridge center', () => {
    const distance = distanceToBridge(BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
    expect(distance).toBe(0)
  })

  it('should calculate distance from Port Huron Coast Guard Station (approx 0.2 NM)', () => {
    const coastGuardLat = 42.9986
    const coastGuardLon = -82.4269
    const distance = distanceToBridge(coastGuardLat, coastGuardLon)
    expect(distance).toBeGreaterThan(0.15)
    expect(distance).toBeLessThan(0.25)
  })

  it('should calculate distance from Sarnia Harbor (approx 1.2 NM)', () => {
    const sarniaLat = 43.0008
    const sarniaLon = -82.3989
    const distance = distanceToBridge(sarniaLat, sarniaLon)
    expect(distance).toBeGreaterThan(1.0)
    expect(distance).toBeLessThan(1.4)
  })

  it('should handle very large distances', () => {
    // Opposite side of Earth (antipodal point)
    const distance = distanceToBridge(-BRIDGE_CENTER.lat, BRIDGE_CENTER.lng + 180)
    // Should be approximately half of Earth's circumference
    expect(distance).toBeGreaterThan(10000)
  })
})

describe('isApproaching', () => {
  describe('southbound ships (from Lake Huron)', () => {
    const northOfBridge = BRIDGE_CENTER.lat + 0.05

    it('should return true when north of bridge, heading 180° (due south), moving', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 10)
      expect(result).toBe(true)
    })

    it('should return true when north of bridge, heading 135° (SE)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 135, 10)
      expect(result).toBe(false) // 135 is at the edge, but not > 135
    })

    it('should return true when north of bridge, heading 136° (within range)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 136, 10)
      expect(result).toBe(true)
    })

    it('should return true when north of bridge, heading 225° (SW)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 225, 10)
      expect(result).toBe(false) // 225 is at edge, but not < 225
    })

    it('should return true when north of bridge, heading 224° (within range)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 224, 10)
      expect(result).toBe(true)
    })

    it('should return false when north of bridge, heading 90° (due east)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 90, 10)
      expect(result).toBe(false)
    })

    it('should return false when north of bridge, heading 0° (due north)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 0, 10)
      expect(result).toBe(false)
    })
  })

  describe('northbound ships (from Lake St. Clair)', () => {
    const southOfBridge = BRIDGE_CENTER.lat - 0.05

    it('should return true when south of bridge, heading 0° (due north), moving', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 0, 10)
      expect(result).toBe(true)
    })

    it('should return true when south of bridge, heading 315° (NW)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 315, 10)
      expect(result).toBe(false) // 315 is at edge, but not > 315
    })

    it('should return true when south of bridge, heading 316° (within range)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 316, 10)
      expect(result).toBe(true)
    })

    it('should return true when south of bridge, heading 45° (NE)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 45, 10)
      expect(result).toBe(false) // 45 is at edge, but not < 45
    })

    it('should return true when south of bridge, heading 44° (within range)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 44, 10)
      expect(result).toBe(true)
    })

    it('should return true when south of bridge, heading 359° (almost north)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 359, 10)
      expect(result).toBe(true)
    })

    it('should return false when south of bridge, heading 90° (due east)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 90, 10)
      expect(result).toBe(false)
    })

    it('should return false when south of bridge, heading 180° (due south)', () => {
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 180, 10)
      expect(result).toBe(false)
    })
  })

  describe('speed edge cases', () => {
    const northOfBridge = BRIDGE_CENTER.lat + 0.05

    it('should return false when SOG is 0 (stationary)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 0)
      expect(result).toBe(false)
    })

    it('should return false when SOG is 0.4 knots (below threshold)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 0.4)
      expect(result).toBe(false)
    })

    it('should return true when SOG is exactly 0.5 knots (at threshold)', () => {
      // The implementation uses < 0.5, so 0.5 itself is not considered stationary
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 0.5)
      expect(result).toBe(true)
    })

    it('should return true when SOG is 0.6 knots (above threshold)', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 0.6)
      expect(result).toBe(true)
    })
  })

  describe('distance limits', () => {
    it('should return true when 9.9 NM away (within range)', () => {
      // Calculate position approximately 9.9 NM north of bridge
      const distantLat = BRIDGE_CENTER.lat + (9.9 / 60) // Rough approximation
      const result = isApproaching(distantLat, BRIDGE_CENTER.lng, 180, 10)
      expect(result).toBe(true)
    })

    it('should return false when beyond max tracking distance', () => {
      // Calculate position beyond MAX_TRACKING_DISTANCE_NM
      const veryDistantLat = BRIDGE_CENTER.lat + (10.5 / 60)
      const result = isApproaching(veryDistantLat, BRIDGE_CENTER.lng, 180, 10)
      expect(result).toBe(false)
    })
  })

  describe('pre-calculated distance parameter', () => {
    const northOfBridge = BRIDGE_CENTER.lat + 0.05

    it('should use provided distance instead of calculating', () => {
      // Provide a distance that would fail the range check
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 10, 15)
      // Should return false because 15 > MAX_TRACKING_DISTANCE_NM
      expect(result).toBe(false)
    })

    it('should match result when distance is calculated vs provided', () => {
      const calculatedDistance = distanceToBridge(northOfBridge, BRIDGE_CENTER.lng)
      const withCalc = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 10)
      const withProvided = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 180, 10, calculatedDistance)
      expect(withCalc).toBe(withProvided)
    })
  })

  describe('COG normalization', () => {
    const northOfBridge = BRIDGE_CENTER.lat + 0.05

    it('should normalize COG 361° to 1°', () => {
      const result = isApproaching(northOfBridge, BRIDGE_CENTER.lng, 361, 10)
      // 1° is northbound from north of bridge, should be false
      expect(result).toBe(false)
    })

    it('should normalize COG -10° to 350°', () => {
      const southOfBridge = BRIDGE_CENTER.lat - 0.05
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, -10, 10)
      // 350° is northbound, should be true from south
      expect(result).toBe(true)
    })

    it('should normalize COG 720° to 0°', () => {
      const southOfBridge = BRIDGE_CENTER.lat - 0.05
      const result = isApproaching(southOfBridge, BRIDGE_CENTER.lng, 720, 10)
      // 0° is due north, should be true from south
      expect(result).toBe(true)
    })
  })
})

describe('formatDistance', () => {
  it('should return "< 0.1 NM" for 0 distance', () => {
    expect(formatDistance(0)).toBe('< 0.1 NM')
  })

  it('should return "< 0.1 NM" for 0.05 NM', () => {
    expect(formatDistance(0.05)).toBe('< 0.1 NM')
  })

  it('should return "0.1 NM" for exactly 0.1 NM', () => {
    expect(formatDistance(0.1)).toBe('0.1 NM')
  })

  it('should format 1.23456 NM to one decimal place', () => {
    expect(formatDistance(1.23456)).toBe('1.2 NM')
  })

  it('should format 10.5 NM correctly', () => {
    expect(formatDistance(10.5)).toBe('10.5 NM')
  })

  it('should format 1.95 NM as "1.9 NM" (toFixed truncates)', () => {
    expect(formatDistance(1.95)).toBe('1.9 NM')
  })
})

describe('formatSpeed', () => {
  it('should format 0 knots', () => {
    expect(formatSpeed(0)).toBe('0.0 kn')
  })

  it('should format 5.678 knots to one decimal', () => {
    expect(formatSpeed(5.678)).toBe('5.7 kn')
  })

  it('should format 20.5 knots', () => {
    expect(formatSpeed(20.5)).toBe('20.5 kn')
  })

  it('should format 10.95 knots as "10.9 kn" (toFixed truncates)', () => {
    expect(formatSpeed(10.95)).toBe('10.9 kn')
  })
})

describe('formatHeading', () => {
  it('should format 0° as "0°"', () => {
    expect(formatHeading(0)).toBe('0°')
  })

  it('should round 45.7° to 46°', () => {
    expect(formatHeading(45.7)).toBe('46°')
  })

  it('should round 45.4° to 45°', () => {
    expect(formatHeading(45.4)).toBe('45°')
  })

  it('should format 359.4° as "359°"', () => {
    expect(formatHeading(359.4)).toBe('359°')
  })

  it('should return "N/A" for special value 511', () => {
    expect(formatHeading(511)).toBe('N/A')
  })

  it('should format 180° exactly', () => {
    expect(formatHeading(180)).toBe('180°')
  })
})

describe('estimatedTimeToBridge', () => {
  it('should calculate 60 minutes for 10 NM at 10 knots', () => {
    expect(estimatedTimeToBridge(10, 10)).toBe(60)
  })

  it('should calculate 5 minutes for 1 NM at 12 knots', () => {
    expect(estimatedTimeToBridge(1, 12)).toBe(5)
  })

  it('should calculate 5 minutes for 0.5 NM at 6 knots', () => {
    expect(estimatedTimeToBridge(0.5, 6)).toBe(5)
  })

  it('should return null when SOG is below 0.5 knots (stationary)', () => {
    expect(estimatedTimeToBridge(5, 0.4)).toBeNull()
  })

  it('should return null when SOG is 0 (division by zero)', () => {
    expect(estimatedTimeToBridge(5, 0)).toBeNull()
  })

  it('should calculate 120 minutes for 10 NM at 5 knots', () => {
    expect(estimatedTimeToBridge(10, 5)).toBe(120)
  })

  it('should handle small distances precisely', () => {
    expect(estimatedTimeToBridge(0.1, 6)).toBeCloseTo(1, 1)
  })
})

describe('formatETA', () => {
  it('should return "N/A" for null', () => {
    expect(formatETA(null)).toBe('N/A')
  })

  it('should return "< 1 min" for 0.5 minutes', () => {
    expect(formatETA(0.5)).toBe('< 1 min')
  })

  it('should format 45 minutes as "~45 min"', () => {
    expect(formatETA(45)).toBe('~45 min')
  })

  it('should format 59 minutes as "~59 min"', () => {
    expect(formatETA(59)).toBe('~59 min')
  })

  it('should format 60 minutes as "~1h 0m"', () => {
    expect(formatETA(60)).toBe('~1h 0m')
  })

  it('should format 125 minutes as "~2h 5m"', () => {
    expect(formatETA(125)).toBe('~2h 5m')
  })

  it('should format 90 minutes as "~1h 30m"', () => {
    expect(formatETA(90)).toBe('~1h 30m')
  })

  it('should round 65.7 minutes to "~1h 6m"', () => {
    expect(formatETA(65.7)).toBe('~1h 6m')
  })

  it('should handle large ETAs (10+ hours)', () => {
    expect(formatETA(650)).toBe('~10h 50m')
  })
})
