'use strict';

const path = require('path');
const express = require('express');

/**
 * Initializes CloudShell: registers routes, sets up WebSocket server,
 * and hooks into the server lifecycle.
 *
 * If node-pty is not available (e.g., native compilation failed),
 * logs a warning and returns a no-op shutdown handle.
 *
 * @param {import('express').Application} app - Management API Express app
 * @param {import('http').Server} httpServer - the underlying HTTP server
 * @param {Function} getActiveServices - function to query active services
 * @returns {{ shutdown: Function }} cleanup handle
 */
function initializeCloudShell(app, httpServer, getActiveServices) {
  try {
    // Attempt to load node-pty to verify it's available
    require('node-pty');
  } catch (err) {
    console.warn('CloudShell: node-pty not available, feature disabled');
    return { shutdown: () => {} };
  }

  const { SessionManager } = require('./session-manager');
  const { createWebSocketServer } = require('./websocket-handler');
  const { registerRoutes } = require('./routes');

  // Instantiate session manager
  const sessionManager = new SessionManager();

  // Register REST API routes
  registerRoutes(app, sessionManager, getActiveServices);

  // Set up WebSocket server
  createWebSocketServer(httpServer, sessionManager);

  // Serve static files (frontend) at /cloudshell
  app.use('/cloudshell', express.static(path.join(__dirname, 'static')));

  return {
    shutdown: () => sessionManager.destroyAll(),
  };
}

module.exports = { initializeCloudShell };
