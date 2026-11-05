'use strict';

const { WebSocketServer } = require('ws');
const url = require('url');

/**
 * Extracts the session ID from a WebSocket upgrade request URL.
 * Expected path format: /ws/cloudshell/:sessionId
 *
 * @param {string} requestUrl - the request URL path
 * @returns {string|null} the session ID, or null if the path doesn't match
 */
function extractSessionId(requestUrl) {
  const pathname = url.parse(requestUrl).pathname;
  const match = pathname && pathname.match(/^\/ws\/cloudshell\/([^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Creates and configures the WebSocket server for CloudShell.
 * Attaches to the existing HTTP server using noServer mode and handles
 * upgrade requests manually for session validation.
 *
 * @param {import('http').Server} httpServer - the Management API HTTP server
 * @param {import('./session-manager').SessionManager} sessionManager - session manager instance
 * @returns {import('ws').WebSocketServer}
 */
function createWebSocketServer(httpServer, sessionManager) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const sessionId = extractSessionId(request.url);

    // Only handle upgrade requests for our path; ignore all others
    if (!sessionId) {
      // Not a CloudShell WebSocket path — do NOT destroy the socket!
      // Let other upgrade handlers (like Vite HMR) process it.
      return;
    }

    console.log('CloudShell: WebSocket upgrade request for session:', sessionId);

    // Validate that the session exists
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      console.log('CloudShell: Session not found, rejecting WebSocket');
      // Reject connection: complete the WebSocket handshake then close with 4004
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.close(4004, 'Session not found');
      });
      return;
    }

    // Accept connection
    console.log('CloudShell: Accepting WebSocket connection');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, sessionId);
    });
  });

  wss.on('connection', (ws, request, sessionId) => {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      ws.close(4004, 'Session not found');
      return;
    }

    // Attach WebSocket to session (pipes PTY output to WS)
    sessionManager.attachWebSocket(sessionId, ws);

    // Handle incoming messages from the client
    ws.on('message', (data) => {
      const currentSession = sessionManager.getSession(sessionId);
      if (!currentSession) return;

      const message = data.toString();

      // Try to parse as JSON resize event
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.type === 'resize') {
          sessionManager.resizeSession(sessionId, parsed.cols, parsed.rows);
          return;
        }
      } catch (e) {
        // Not JSON; treat as raw terminal input
      }

      // Write raw input to PTY stdin
      try {
        currentSession.pty.write(message);
      } catch (err) {
        // PTY may have exited; ignore write errors
      }
    });

    // On WebSocket close: detach from session (keep PTY alive)
    ws.on('close', () => {
      // The attachWebSocket already sets up close listener to null out ws,
      // so no additional detach logic needed here. PTY stays alive.
    });
  });

  return wss;
}

module.exports = { createWebSocketServer, extractSessionId };
