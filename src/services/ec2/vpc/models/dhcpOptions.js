/**
 * DHCP Options Model
 *
 * Conjunto de opções de DHCP (domain name, DNS servers, NTP, NetBIOS) que pode
 * ser associado a uma VPC.
 */

const { generateResourceId } = require('./identifier');

class DhcpOptions {
  /**
   * @param {Array<{Key: string, Values: Array<{Value: string}>}>} configurations
   * @param {Array} tags
   * @param {boolean} isDefault
   */
  constructor(configurations = [], tags = [], isDefault = false) {
    this.DhcpOptionsId = generateResourceId('dopt');
    this.DhcpConfigurations = configurations;
    this.Tags = tags;
    this.IsDefault = isDefault;
    this.OwnerId = '123456789012';
  }

  /**
   * Conjunto padrão de DHCP options (equivalente ao que a AWS cria por região).
   */
  static defaultOptions() {
    const options = new DhcpOptions(
      [
        { Key: 'domain-name-servers', Values: [{ Value: 'AmazonProvidedDNS' }] },
        { Key: 'domain-name', Values: [{ Value: 'ec2.internal' }] }
      ],
      [],
      true
    );
    options.OwnerId = '123456789012';
    return options;
  }

  toJSON() {
    return {
      DhcpOptionsId: this.DhcpOptionsId,
      DhcpConfigurations: this.DhcpConfigurations,
      Tags: this.Tags,
      IsDefault: this.IsDefault,
      OwnerId: this.OwnerId
    };
  }

  static fromJSON(data = {}) {
    const options = new DhcpOptions(
      data.DhcpConfigurations || [],
      data.Tags || [],
      data.IsDefault || false
    );
    options.DhcpOptionsId = data.DhcpOptionsId || options.DhcpOptionsId;
    options.OwnerId = data.OwnerId || options.OwnerId;
    return options;
  }
}

module.exports = DhcpOptions;
