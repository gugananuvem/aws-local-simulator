'use strict';

const { buildShellEnvironment } = require('./env-builder');

/**
 * Registers CloudShell REST API routes on the Express app.
 *
 * @param {import('express').Application} app - the Management API Express app
 * @param {import('./session-manager').SessionManager} sessionManager - session manager instance
 * @param {Function} getActiveServices - function returning active services and ports
 */
function registerRoutes(app, sessionManager, getActiveServices) {
  /**
   * GET /__admin/cloudshell/sessions
   * Returns all active sessions with IDs and creation timestamps.
   */
  app.get('/__admin/cloudshell/sessions', (req, res) => {
    console.log('CloudShell: GET /sessions received');
    const sessions = sessionManager.listSessions();
    res.json({ sessions });
  });

  /**
   * POST /__admin/cloudshell/sessions
   * Creates a new CloudShell session with pre-configured environment.
   * Returns 201 with { id, createdAt } on success.
   * Returns 500 with { error } if PTY spawn fails.
   */
  app.post('/__admin/cloudshell/sessions', (req, res) => {
    console.log('CloudShell: POST /sessions received');
    try {
      const env = buildShellEnvironment(getActiveServices);
      console.log('CloudShell: Environment built, creating session...');
      const session = sessionManager.createSession(env);
      console.log('CloudShell: Session created:', session.id);
      res.status(201).json({ id: session.id, createdAt: session.createdAt });
    } catch (err) {
      console.error('CloudShell: Failed to create session:', err.message);
      res.status(500).json({ error: 'Failed to create session: ' + err.message });
    }
  });

  /**
   * DELETE /__admin/cloudshell/sessions/:id
   * Terminates a specific session.
   * Returns 200 on success, 404 if session not found.
   */
  app.delete('/__admin/cloudshell/sessions/:id', (req, res) => {
    const { id } = req.params;
    const destroyed = sessionManager.destroySession(id);

    if (destroyed) {
      res.status(200).json({});
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });
}

module.exports = { registerRoutes };
