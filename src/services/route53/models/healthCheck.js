/**
 * Route53 Health Check Model
 * Supports HTTP, HTTPS, TCP, and calculated health checks
 */

class HealthCheck {
  constructor(config = {}) {
    this.Id = this.generateHealthCheckId();
    this.Type = config.Type || 'HTTP'; // HTTP, HTTPS, TCP, CALCULATED
    this.Protocol = config.Protocol || 'HTTP';
    this.IPAddress = config.IPAddress || '127.0.0.1';
    this.Port = config.Port || 80;
    this.ResourcePath = config.ResourcePath || '/';
    this.FullyQualifiedDomainName = config.FullyQualifiedDomainName || 'localhost';
    this.RequestInterval = config.RequestInterval || 30;
    this.FailureThreshold = config.FailureThreshold || 3;
    this.Enabled = config.Enabled !== false;
    this.Status = 'Healthy'; // Healthy, Unhealthy
    this.LastStatusChangeTime = new Date().toISOString();
    this.CreatedDate = new Date().toISOString();
    this.MeasureLatency = config.MeasureLatency || false;
    this.HealthThreshold = config.HealthThreshold || 1;
    this.ChildHealthChecks = config.ChildHealthChecks || [];
    this.FailedChecks = 0;
    this.LastCheckResult = {
      status: 'Success',
      timestamp: new Date().toISOString(),
      latency: Math.random() * 100, // 0-100ms
    };
  }

  generateHealthCheckId() {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 32; i++) {
      id += chars.charAt(Math.floor(Math.random() * 16));
    }
    return id;
  }

  /**
   * Simulate health check
   */
  check() {
    if (!this.Enabled) {
      this.Status = 'Disabled';
      return false;
    }

    // Simulate health check with 95% success rate
    const isHealthy = Math.random() > 0.05;

    if (isHealthy) {
      this.FailedChecks = 0;
      if (this.Status !== 'Healthy') {
        this.Status = 'Healthy';
        this.LastStatusChangeTime = new Date().toISOString();
      }
    } else {
      this.FailedChecks++;
      if (this.FailedChecks >= this.FailureThreshold) {
        this.Status = 'Unhealthy';
        this.LastStatusChangeTime = new Date().toISOString();
      }
    }

    this.LastCheckResult = {
      status: isHealthy ? 'Success' : 'Failed',
      timestamp: new Date().toISOString(),
      latency: Math.random() * 100,
    };

    return isHealthy;
  }

  toJSON() {
    return {
      Id: this.Id,
      Type: this.Type,
      HealthCheckConfig: {
        Type: this.Type,
        Protocol: this.Protocol,
        IPAddress: this.IPAddress,
        Port: this.Port,
        ResourcePath: this.ResourcePath,
        FullyQualifiedDomainName: this.FullyQualifiedDomainName,
        RequestInterval: this.RequestInterval,
        FailureThreshold: this.FailureThreshold,
        MeasureLatency: this.MeasureLatency,
        HealthThreshold: this.HealthThreshold,
      },
      HealthCheckObservations: {
        Status: this.Status,
        LastStatusChangeTime: this.LastStatusChangeTime,
        LastCheckResult: this.LastCheckResult,
      },
    };
  }
}

module.exports = HealthCheck;
