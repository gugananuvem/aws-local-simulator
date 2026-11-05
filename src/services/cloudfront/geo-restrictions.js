

/**
 * Geo-Restrictions Handler for CloudFront
 * Manages geographic restrictions for distributions based on country codes
 */
class GeoRestrictions {
  constructor() {
    // ISO 3166-1 alpha-2 country code validation
    this.validCountryCodes = this._initializeCountryCodes();
    this.requestCache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Check if a request should be allowed based on geo-restrictions
   * @param {object} geoRestriction - GeoRestriction object from Distribution
   * @param {string} clientCountry - Country code of the client (ISO 3166-1 alpha-2)
   * @param {object} [requestContext] - Additional context for logging/debugging
   * @returns {object} Geo-restriction check result
   */
  checkGeoRestriction(geoRestriction, clientCountry, requestContext = {}) {
    if (!geoRestriction || !geoRestriction.restrictionType) {
      return {
        isAllowed: true,
        reason: 'NO_RESTRICTIONS'
      };
    }

    const normalizedCountry = clientCountry?.toUpperCase();
    const { restrictionType, locations = [] } = geoRestriction;

    // Validate country code
    if (!this._isValidCountryCode(normalizedCountry)) {
      return {
        isAllowed: false,
        reason: 'INVALID_COUNTRY_CODE',
        country: clientCountry,
        error: `Invalid country code: ${clientCountry}`
      };
    }

    let isAllowed = false;
    let reason = '';

    if (restrictionType === 'whitelist') {
      isAllowed = locations.includes(normalizedCountry);
      reason = isAllowed ? 'WHITELISTED_COUNTRY' : 'COUNTRY_NOT_WHITELISTED';
    } else if (restrictionType === 'blacklist') {
      isAllowed = !locations.includes(normalizedCountry);
      reason = isAllowed ? 'COUNTRY_NOT_BLACKLISTED' : 'BLACKLISTED_COUNTRY';
    } else {
      return {
        isAllowed: true,
        reason: 'UNKNOWN_RESTRICTION_TYPE'
      };
    }

    return {
      isAllowed: isAllowed,
      reason: reason,
      country: normalizedCountry,
      restrictionType: restrictionType,
      timestamp: new Date().toISOString(),
      requestContext: requestContext
    };
  }

  /**
   * Validate geo-restriction configuration
   * @param {object} geoRestriction - GeoRestriction object
   * @returns {object} Validation result
   */
  validateGeoRestriction(geoRestriction) {
    const errors = [];
    const warnings = [];

    if (!geoRestriction) {
      return {
        isValid: true,
        message: 'No geo-restrictions configured'
      };
    }

    // Validate restriction type
    const validTypes = ['whitelist', 'blacklist'];
    if (!validTypes.includes(geoRestriction.restrictionType)) {
      errors.push(
        `Invalid restriction type: ${geoRestriction.restrictionType}. Must be 'whitelist' or 'blacklist'`
      );
    }

    // Validate locations
    if (!Array.isArray(geoRestriction.locations)) {
      errors.push('Locations must be an array');
    } else {
      const invalidCodes = [];
      for (const code of geoRestriction.locations) {
        if (!this._isValidCountryCode(code)) {
          invalidCodes.push(code);
        }
      }

      if (invalidCodes.length > 0) {
        errors.push(
          `Invalid country codes: ${invalidCodes.join(', ')}`
        );
      }

      if (geoRestriction.locations.length === 0) {
        warnings.push('No locations specified in geo-restriction');
      }

      // Warn if quantity doesn't match
      if (
        geoRestriction.quantity !== geoRestriction.locations.length
      ) {
        warnings.push(
          `Quantity mismatch: specified ${geoRestriction.quantity} but has ${geoRestriction.locations.length} locations`
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  /**
   * Get country information
   * @param {string} countryCode - ISO 3166-1 alpha-2 country code
   * @returns {object} Country information
   */
  getCountryInfo(countryCode) {
    const code = countryCode?.toUpperCase();
    
    if (!this._isValidCountryCode(code)) {
      return null;
    }

    return {
      code: code,
      name: this._getCountryName(code),
      region: this._getCountryRegion(code)
    };
  }

  /**
   * Get list of all valid country codes
   * @returns {string[]} Array of ISO 3166-1 alpha-2 country codes
   */
  getAllCountryCodes() {
    return Array.from(this.validCountryCodes);
  }

  /**
   * Get countries by region
   * @param {string} region - Region name (e.g., 'EU', 'ASIA', 'AMERICAS')
   * @returns {string[]} Array of country codes
   */
  getCountriesByRegion(region) {
    const regionCode = region?.toUpperCase();
    const countries = [];

    const regionMap = {
      'EU': ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
      'ASIA': ['CN', 'JP', 'KR', 'IN', 'TH', 'VN', 'SG', 'MY', 'PH', 'ID', 'HK', 'TW', 'BD', 'PK', 'LK', 'KZ', 'UZ', 'TM', 'KG'],
      'AMERICAS': ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'CU', 'DO', 'JM', 'TT'],
      'AFRICA': ['NG', 'EG', 'ZA', 'KE', 'ET', 'GH', 'TZ', 'UG', 'DZ', 'MA', 'TN', 'SD', 'AO', 'ZM', 'ZW'],
      'OCEANIA': ['AU', 'NZ', 'FJ', 'PG', 'SB', 'VU']
    };

    return regionMap[regionCode] || [];
  }

  /**
   * Generate a geo-restriction report
   * @param {object} geoRestriction - GeoRestriction object
   * @returns {object} Detailed report
   */
  generateReport(geoRestriction) {
    if (!geoRestriction) {
      return {
        status: 'NO_RESTRICTIONS',
        report: 'No geo-restrictions configured'
      };
    }

    const validation = this.validateGeoRestriction(geoRestriction);
    const locations = geoRestriction.locations || [];
    const countryDetails = locations.map(code => ({
      code: code,
      name: this._getCountryName(code),
      region: this._getCountryRegion(code)
    }));

    return {
      status: 'ACTIVE',
      restrictionType: geoRestriction.restrictionType,
      totalCountries: locations.length,
      countries: countryDetails,
      validation: validation,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Estimate impact of geo-restrictions (rough statistics)
   * @param {object} geoRestriction - GeoRestriction object
   * @returns {object} Impact estimate
   */
  estimateRestrictionImpact(geoRestriction) {
    if (!geoRestriction || !geoRestriction.locations) {
      return {
        estimatedAffected: 0,
        estimatedAccessible: 100
      };
    }

    // Rough estimates for demonstration (these would come from real data in production)
    const globalPopulation = 100; // Represents 100%
    const locationCount = geoRestriction.locations.length;
    const countryCount = this.getAllCountryCodes().length;

    let estimatedAffected = (locationCount / countryCount) * globalPopulation;

    if (geoRestriction.restrictionType === 'whitelist') {
      // Whitelisting specific countries
      estimatedAffected = (locationCount / countryCount) * globalPopulation;
    } else if (geoRestriction.restrictionType === 'blacklist') {
      // Blacklisting specific countries
      estimatedAffected = (locationCount / countryCount) * globalPopulation;
    }

    return {
      estimatedAffected: Math.round(estimatedAffected * 100) / 100,
      estimatedAccessible: Math.round((globalPopulation - estimatedAffected) * 100) / 100,
      locationCount: locationCount,
      restrictionType: geoRestriction.restrictionType
    };
  }

  /**
   * Create a geo-restriction from country names (convenience method)
   * @param {string} type - 'whitelist' or 'blacklist'
   * @param {string[]} countryNames - Array of country names
   * @returns {object} Geo-restriction object
   */
  createFromCountryNames(type, countryNames) {
    const countryCodes = countryNames
      .map(name => this._getCountryCodeByName(name))
      .filter(code => code !== null);

    return {
      restrictionType: type,
      quantity: countryCodes.length,
      locations: countryCodes
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.requestCache.clear();
  }

  /**
   * Private Methods
   */

  _initializeCountryCodes() {
    // ISO 3166-1 alpha-2 country codes
    return new Set([
      'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
      'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
      'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
      'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
      'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
      'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
      'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
      'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
      'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
      'JE', 'JM', 'JO', 'JP',
      'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
      'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
      'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
      'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
      'OM',
      'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
      'QA',
      'RE', 'RO', 'RS', 'RU', 'RW',
      'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
      'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
      'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
      'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
      'WF', 'WS',
      'YE', 'YT',
      'ZA', 'ZM', 'ZW'
    ]);
  }

  _isValidCountryCode(code) {
    if (!code || typeof code !== 'string') return false;
    return this.validCountryCodes.has(code.toUpperCase());
  }

  _getCountryName(code) {
    const countryNames = {
      'US': 'United States',
      'GB': 'United Kingdom',
      'CA': 'Canada',
      'AU': 'Australia',
      'JP': 'Japan',
      'DE': 'Germany',
      'FR': 'France',
      'BR': 'Brazil',
      'IN': 'India',
      'CN': 'China',
      'MX': 'Mexico',
      'ZA': 'South Africa',
      'SG': 'Singapore',
      'NZ': 'New Zealand',
      'NL': 'Netherlands',
      'SE': 'Sweden',
      'NO': 'Norway',
      'ES': 'Spain',
      'IT': 'Italy',
      'KR': 'South Korea',
      // Add more as needed
    };

    return countryNames[code] || code;
  }

  _getCountryRegion(code) {
    const regionMap = {
      'US': 'AMERICAS', 'CA': 'AMERICAS', 'MX': 'AMERICAS', 'BR': 'AMERICAS', 'AR': 'AMERICAS',
      'GB': 'EU', 'DE': 'EU', 'FR': 'EU', 'IT': 'EU', 'ES': 'EU', 'NL': 'EU', 'SE': 'EU', 'NO': 'EU',
      'JP': 'ASIA', 'CN': 'ASIA', 'IN': 'ASIA', 'SG': 'ASIA', 'KR': 'ASIA', 'AU': 'OCEANIA', 'NZ': 'OCEANIA',
      'ZA': 'AFRICA', 'EG': 'AFRICA',
    };

    return regionMap[code] || 'UNKNOWN';
  }

  _getCountryCodeByName(name) {
    const nameToCode = {
      'United States': 'US',
      'United Kingdom': 'GB',
      'Canada': 'CA',
      'Australia': 'AU',
      'Japan': 'JP',
      'Germany': 'DE',
      'France': 'FR',
      'Brazil': 'BR',
      'India': 'IN',
      'China': 'CN',
      'Mexico': 'MX',
      'South Africa': 'ZA',
      'Singapore': 'SG',
      'New Zealand': 'NZ',
      'Netherlands': 'NL',
      'Sweden': 'SE',
      'Norway': 'NO',
      'Spain': 'ES',
      'Italy': 'IT',
      'South Korea': 'KR',
    };

    return nameToCode[name] || null;
  }
}

module.exports = GeoRestrictions;
