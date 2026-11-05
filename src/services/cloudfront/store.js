const fs = require('fs');
const path = require('path');

/**
 * CloudFront JSON Persistence Store
 * Manages persistence of distributions and related data to JSON files
 */
class CloudFrontStore {
  constructor(storePath = './data/cloudfront') {
    this.storePath = storePath;
    this.distributionsFile = path.join(storePath, 'distributions.json');
    this.invalidationsFile = path.join(storePath, 'invalidations.json');
    this.keyPairsFile = path.join(storePath, 'key-pairs.json');
    this.init();
  }

  /**
   * Initialize store - create directories and files if needed
   */
  init() {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }

    // Initialize distribution file
    if (!fs.existsSync(this.distributionsFile)) {
      this._writeFile(this.distributionsFile, { distributions: [] });
    }

    // Initialize invalidations file
    if (!fs.existsSync(this.invalidationsFile)) {
      this._writeFile(this.invalidationsFile, { invalidations: [] });
    }

    // Initialize key pairs file
    if (!fs.existsSync(this.keyPairsFile)) {
      this._writeFile(this.keyPairsFile, { keyPairs: [] });
    }
  }

  /**
   * Save a distribution
   * @param {object} distribution - Distribution object
   */
  saveDistribution(distribution) {
    const data = this._readFile(this.distributionsFile);
    
    const index = data.distributions.findIndex(d => d.id === distribution.id);
    if (index !== -1) {
      data.distributions[index] = distribution;
    } else {
      data.distributions.push(distribution);
    }

    this._writeFile(this.distributionsFile, data);
  }

  /**
   * Get a distribution
   * @param {string} distributionId - Distribution ID
   * @returns {object|null} Distribution or null
   */
  getDistribution(distributionId) {
    const data = this._readFile(this.distributionsFile);
    return data.distributions.find(d => d.id === distributionId) || null;
  }

  /**
   * Get all distributions
   * @returns {object[]} Array of distributions
   */
  getAllDistributions() {
    const data = this._readFile(this.distributionsFile);
    return data.distributions || [];
  }

  /**
   * Delete a distribution
   * @param {string} distributionId - Distribution ID
   * @returns {boolean} True if deleted
   */
  deleteDistribution(distributionId) {
    const data = this._readFile(this.distributionsFile);
    
    const index = data.distributions.findIndex(d => d.id === distributionId);
    if (index === -1) {
      return false;
    }

    data.distributions.splice(index, 1);
    this._writeFile(this.distributionsFile, data);
    return true;
  }

  /**
   * Save invalidation
   * @param {object} invalidation - Invalidation object
   */
  saveInvalidation(invalidation) {
    const data = this._readFile(this.invalidationsFile);
    
    const index = data.invalidations.findIndex(i => i.id === invalidation.id);
    if (index !== -1) {
      data.invalidations[index] = invalidation;
    } else {
      data.invalidations.push(invalidation);
    }

    this._writeFile(this.invalidationsFile, data);
  }

  /**
   * Get invalidation
   * @param {string} invalidationId - Invalidation ID
   * @returns {object|null} Invalidation or null
   */
  getInvalidation(invalidationId) {
    const data = this._readFile(this.invalidationsFile);
    return data.invalidations.find(i => i.id === invalidationId) || null;
  }

  /**
   * Get invalidations by distribution
   * @param {string} distributionId - Distribution ID
   * @returns {object[]} Array of invalidations
   */
  getInvalidationsByDistribution(distributionId) {
    const data = this._readFile(this.invalidationsFile);
    return data.invalidations.filter(i => i.distributionId === distributionId) || [];
  }

  /**
   * Delete invalidation
   * @param {string} invalidationId - Invalidation ID
   * @returns {boolean} True if deleted
   */
  deleteInvalidation(invalidationId) {
    const data = this._readFile(this.invalidationsFile);
    
    const index = data.invalidations.findIndex(i => i.id === invalidationId);
    if (index === -1) {
      return false;
    }

    data.invalidations.splice(index, 1);
    this._writeFile(this.invalidationsFile, data);
    return true;
  }

  /**
   * Save key pair
   * @param {object} keyPair - Key pair object
   */
  saveKeyPair(keyPair) {
    const data = this._readFile(this.keyPairsFile);
    
    const index = data.keyPairs.findIndex(k => k.id === keyPair.id);
    if (index !== -1) {
      data.keyPairs[index] = keyPair;
    } else {
      data.keyPairs.push(keyPair);
    }

    this._writeFile(this.keyPairsFile, data);
  }

  /**
   * Get key pair
   * @param {string} keyPairId - Key pair ID
   * @returns {object|null} Key pair or null
   */
  getKeyPair(keyPairId) {
    const data = this._readFile(this.keyPairsFile);
    return data.keyPairs.find(k => k.id === keyPairId) || null;
  }

  /**
   * Get all key pairs
   * @returns {object[]} Array of key pairs
   */
  getAllKeyPairs() {
    const data = this._readFile(this.keyPairsFile);
    return data.keyPairs || [];
  }

  /**
   * Delete key pair
   * @param {string} keyPairId - Key pair ID
   * @returns {boolean} True if deleted
   */
  deleteKeyPair(keyPairId) {
    const data = this._readFile(this.keyPairsFile);
    
    const index = data.keyPairs.findIndex(k => k.id === keyPairId);
    if (index === -1) {
      return false;
    }

    data.keyPairs.splice(index, 1);
    this._writeFile(this.keyPairsFile, data);
    return true;
  }

  /**
   * Export all data
   * @returns {object} All data in the store
   */
  export() {
    return {
      distributions: this.getAllDistributions(),
      invalidations: this._readFile(this.invalidationsFile).invalidations || [],
      keyPairs: this.getAllKeyPairs(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import data
   * @param {object} data - Data to import
   */
  import(data) {
    if (data.distributions && Array.isArray(data.distributions)) {
      const distributionData = { distributions: data.distributions };
      this._writeFile(this.distributionsFile, distributionData);
    }

    if (data.invalidations && Array.isArray(data.invalidations)) {
      const invalidationData = { invalidations: data.invalidations };
      this._writeFile(this.invalidationsFile, invalidationData);
    }

    if (data.keyPairs && Array.isArray(data.keyPairs)) {
      const keyPairData = { keyPairs: data.keyPairs };
      this._writeFile(this.keyPairsFile, keyPairData);
    }
  }

  /**
   * Clear all data
   */
  clear() {
    this._writeFile(this.distributionsFile, { distributions: [] });
    this._writeFile(this.invalidationsFile, { invalidations: [] });
    this._writeFile(this.keyPairsFile, { keyPairs: [] });
  }

  /**
   * Get storage stats
   * @returns {object} Storage statistics
   */
  getStats() {
    const distributionData = this._readFile(this.distributionsFile);
    const invalidationData = this._readFile(this.invalidationsFile);
    const keyPairData = this._readFile(this.keyPairsFile);

    return {
      distributions: distributionData.distributions?.length || 0,
      invalidations: invalidationData.invalidations?.length || 0,
      keyPairs: keyPairData.keyPairs?.length || 0,
      storePath: this.storePath,
      lastModified: new Date().toISOString()
    };
  }

  /**
   * Create a backup
   * @param {string} [backupPath] - Optional custom backup path
   * @returns {string} Path to backup file
   */
  createBackup(backupPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = backupPath || path.join(this.storePath, `backup-${timestamp}.json`);
    
    const data = this.export();
    this._writeFile(backup, data);
    
    return backup;
  }

  /**
   * Restore from backup
   * @param {string} backupPath - Path to backup file
   */
  restoreFromBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const data = this._readFile(backupPath);
    this.import(data);
  }

  /**
   * Private Methods
   */

  _readFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return {};
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return {};
    }
  }

  _writeFile(filePath, data) {
    try {
      const directory = path.dirname(filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error);
      throw error;
    }
  }
}

module.exports = CloudFrontStore;
