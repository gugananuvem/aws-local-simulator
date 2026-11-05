/**
 * AWS Organizations - Invitation (Handshake) Model
 * Representa um convite para uma conta entrar na organização.
 */

const { v4: uuidv4 } = require('uuid');

const EXPIRATION_DAYS = 15;

class Invitation {
  constructor(config = {}) {
    this.id = config.id || `h-${uuidv4().substring(0, 8)}`;
    this.organizationId = config.organizationId;
    this.email = config.email;
    this.accountId = config.accountId || null;
    this.message = config.message || '';
    this.state = config.state || 'REQUESTED'; // REQUESTED | ACCEPTED | DECLINED | CANCELED | EXPIRED
    this.action = config.action || 'INVITE';
    this.requestedTimestamp = config.requestedTimestamp || Math.floor(Date.now() / 1000);
    this.expirationTimestamp =
      config.expirationTimestamp || this.requestedTimestamp + EXPIRATION_DAYS * 24 * 60 * 60;
    this.completedTimestamp = config.completedTimestamp || null;
  }

  /**
   * Formato Handshake do AWS Organizations.
   */
  toHandshake() {
    const parties = [
      { Id: this.organizationId, Type: 'ORGANIZATION' },
      { Id: this.email, Type: 'EMAIL' },
    ];

    return {
      Id: this.id,
      Arn: `arn:aws:organizations::123456789012:handshake/o-${this.organizationId}/invite/${this.id}`,
      Parties: parties,
      State: this.state,
      Action: this.action,
      RequestedTimestamp: this.requestedTimestamp,
      ExpirationTimestamp: this.expirationTimestamp,
      CompletedTimestamp: this.completedTimestamp,
      Resources: this.accountId ? [{ Type: 'ACCOUNT', Value: this.accountId }] : [],
    };
  }
}

module.exports = Invitation;
