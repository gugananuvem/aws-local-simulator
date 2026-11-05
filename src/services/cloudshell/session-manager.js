'use strict';

const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');

/**
 * Returns the default shell for the current platform.
 * @returns {string} shell executable path or name
 */
function getDefaultShell() {
  if (process.platform === 'win32') {
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * @typedef {Object} Session
 * @property {string} id - UUID v4 session identifier
 * @property {import('node-pty').IPty} pty - node-pty process instance
 * @property {import('ws').WebSocket|null} ws - currently attached WebSocket (null if disconnected)
 * @property {string} createdAt - ISO timestamp of session creation
 */

/**
 * Manages the lifecycle of CloudShell terminal sessions.
 * Stores sessions in an in-memory Map<string, Session>.
 */
class SessionManager {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  /**
   * Creates a new PTY session with pre-configured environment.
   * @param {Object} env - environment variables to inject into the PTY process
   * @returns {Session} the newly created session
   */
  createSession(env) {
    const shell = getDefaultShell();
    const id = uuidv4();

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: env,
      });
    } catch (err) {
      throw new Error(`Failed to spawn PTY (${shell}): ${err.message}`);
    }

    const session = {
      id,
      pty: ptyProcess,
      ws: null,
      createdAt: new Date().toISOString(),
    };

    // Handle unexpected PTY exit to clean up session
    ptyProcess.onExit(({ exitCode, signal }) => {
      // Only clean up if session still exists (wasn't explicitly destroyed)
      if (this.sessions.has(id)) {
        const s = this.sessions.get(id);
        if (s && s.ws) {
          try {
            s.ws.close(1011, 'PTY process exited');
          } catch (e) { /* ignore */ }
        }
        this.sessions.delete(id);
      }
    });

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Returns a session by ID, or undefined if not found.
   * @param {string} id - session ID
   * @returns {Session|undefined}
   */
  getSession(id) {
    return this.sessions.get(id);
  }

  /**
   * Lists all active sessions.
   * @returns {Array<{id: string, createdAt: string}>}
   */
  listSessions() {
    const result = [];
    for (const session of this.sessions.values()) {
      result.push({ id: session.id, createdAt: session.createdAt });
    }
    return result;
  }

  /**
   * Terminates a session: kills PTY, closes WebSocket, removes from map.
   * @param {string} id - session ID to destroy
   * @returns {boolean} true if session existed and was terminated
   */
  destroySession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    try {
      session.pty.kill();
    } catch (err) {
      // PTY may already be dead; ignore
    }

    if (session.ws) {
      try {
        session.ws.close(1011, 'Session terminated');
      } catch (err) {
        // WebSocket may already be closed; ignore
      }
      session.ws = null;
    }

    this.sessions.delete(id);
    return true;
  }

  /**
   * Terminates all sessions. Called on server shutdown.
   */
  destroyAll() {
    for (const id of this.sessions.keys()) {
      this.destroySession(id);
    }
  }

  /**
   * Attaches a WebSocket to an existing session and pipes PTY output to WS.
   * @param {string} id - session ID
   * @param {import('ws').WebSocket} ws - WebSocket connection to attach
   * @returns {boolean} true if session exists and was attached
   */
  attachWebSocket(id, ws) {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    // Detach any previously attached WebSocket
    if (session.ws) {
      try {
        session.ws.close(1000, 'Replaced by new connection');
      } catch (err) {
        // ignore
      }
    }

    session.ws = ws;

    // Pipe PTY output to WebSocket
    const dataListener = session.pty.onData((data) => {
      if (session.ws && session.ws.readyState === 1) { // WebSocket.OPEN === 1
        session.ws.send(data);
      }
    });

    // Clean up listener when WebSocket closes
    ws.on('close', () => {
      dataListener.dispose();
      if (session.ws === ws) {
        session.ws = null;
      }
    });

    return true;
  }

  /**
   * Detaches the WebSocket from a session (keeps PTY alive).
   * @param {string} id - session ID
   */
  detachWebSocket(id) {
    const session = this.sessions.get(id);
    if (!session || !session.ws) {
      return;
    }

    try {
      session.ws.close(1000, 'Detached');
    } catch (err) {
      // ignore
    }
    session.ws = null;
  }

  /**
   * Resizes the PTY for a given session. Ignores invalid (≤0) values.
   * @param {string} id - session ID
   * @param {number} cols - new column count
   * @param {number} rows - new row count
   */
  resizeSession(id, cols, rows) {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    // Ignore invalid dimensions
    if (!cols || !rows || cols <= 0 || rows <= 0) {
      return;
    }

    try {
      session.pty.resize(cols, rows);
    } catch (err) {
      // PTY may have exited; ignore resize errors
    }
  }
}

module.exports = { SessionManager, getDefaultShell };
