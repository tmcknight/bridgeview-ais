import { Server as MockWebSocketServer, WebSocket as MockWebSocket } from 'mock-socket'
import type { AISMessage } from '../../types/ais'

/**
 * Mock WebSocket server for testing AIS stream integration
 */
export class MockAISStreamServer {
  private server: MockWebSocketServer
  private url: string
  private clientSockets: MockWebSocket[] = []

  constructor(url: string = 'ws://localhost:3001') {
    this.url = url
    this.server = new MockWebSocketServer(url)

    // Track connected clients
    this.server.on('connection', (socket) => {
      this.clientSockets.push(socket)
    })
  }

  /**
   * Send a position report message to all connected clients
   */
  sendPositionReport(message: AISMessage): void {
    this.broadcast(JSON.stringify(message))
  }

  /**
   * Send a static data message to all connected clients
   */
  sendStaticData(message: AISMessage): void {
    this.broadcast(JSON.stringify(message))
  }

  /**
   * Send an authentication confirmation
   */
  sendAuthConfirmation(): void {
    this.broadcast(JSON.stringify({ type: 'authenticated' }))
  }

  /**
   * Send raw JSON string to all clients
   */
  sendRawMessage(message: string): void {
    this.broadcast(message)
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(data: string): void {
    this.clientSockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data)
      }
    })
  }

  /**
   * Wait for a subscription message from the client
   */
  async waitForSubscription(): Promise<unknown> {
    return new Promise((resolve) => {
      const handleMessage = (data: string) => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.BoundingBoxes) {
            resolve(parsed)
          }
        } catch (error) {
          // Ignore parse errors
        }
      }

      this.server.on('message', handleMessage)
    })
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clientSockets.length
  }

  /**
   * Close the mock server
   */
  close(): void {
    this.clientSockets = []
    this.server.close()
  }

  /**
   * Simulate connection close from server side
   */
  closeAllConnections(): void {
    this.clientSockets.forEach((socket) => {
      socket.close()
    })
    this.clientSockets = []
  }

  /**
   * Simulate server error
   */
  simulateError(): void {
    this.clientSockets.forEach((socket) => {
      socket.dispatchEvent(new Event('error'))
    })
  }
}

/**
 * Helper to create a mock WebSocket server for tests
 */
export const createMockWSServer = (url?: string): MockAISStreamServer => {
  return new MockAISStreamServer(url)
}
