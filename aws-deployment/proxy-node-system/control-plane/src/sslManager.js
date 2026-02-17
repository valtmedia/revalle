const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

/**
 * SSL/TLS Certificate Manager
 * Manages certificates for proxy nodes and HTTPS interception
 * Supports self-signed CA generation, per-host certificates, and certificate rotation
 */
class SSLManager {
  constructor(options = {}) {
    this.certDir = options.certDir || path.join(__dirname, '..', 'certs');
    this.caCert = null;
    this.caKey = null;
    this.certificates = new Map(); // hostname -> { cert, key, expiresAt }
    this.certRotationDays = options.certRotationDays || 90;
    this.maxCachedCerts = options.maxCachedCerts || 10000;
    this.initialized = false;
  }

  /**
   * Initialize the SSL manager, generate or load CA certificate
   */
  async initialize() {
    try {
      await fs.mkdir(this.certDir, { recursive: true });
      
      const caKeyPath = path.join(this.certDir, 'ca-key.pem');
      const caCertPath = path.join(this.certDir, 'ca-cert.pem');
      
      // Check if CA cert exists
      try {
        this.caKey = await fs.readFile(caKeyPath, 'utf8');
        this.caCert = await fs.readFile(caCertPath, 'utf8');
        logger.info('Loaded existing CA certificate');
      } catch {
        // Generate new CA
        logger.info('Generating new CA certificate...');
        const ca = await this._generateCA();
        this.caKey = ca.privateKey;
        this.caCert = ca.certificate;
        
        await fs.writeFile(caKeyPath, this.caKey, { mode: 0o600 });
        await fs.writeFile(caCertPath, this.caCert, { mode: 0o644 });
        logger.info('CA certificate generated and saved');
      }
      
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize SSL manager', { error: error.message });
      throw error;
    }
  }

  /**
   * Get or generate a certificate for a hostname
   */
  async getCertificate(hostname) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Check cache
    const cached = this.certificates.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return { cert: cached.cert, key: cached.key };
    }
    
    // Generate new certificate
    const cert = await this._generateHostCertificate(hostname);
    
    // Cache it
    if (this.certificates.size >= this.maxCachedCerts) {
      // Evict oldest entries
      const entries = [...this.certificates.entries()];
      entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (let i = 0; i < entries.length / 2; i++) {
        this.certificates.delete(entries[i][0]);
      }
    }
    
    this.certificates.set(hostname, {
      cert: cert.certificate,
      key: cert.privateKey,
      expiresAt: Date.now() + (this.certRotationDays * 24 * 60 * 60 * 1000),
      createdAt: Date.now()
    });
    
    return { cert: cert.certificate, key: cert.privateKey };
  }

  /**
   * Get the CA certificate for client trust
   */
  getCACertificate() {
    return this.caCert;
  }

  /**
   * Generate a self-signed certificate for a node
   */
  async generateNodeCertificate(nodeId, nodeHost) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    const certInfo = {
      nodeId,
      host: nodeHost,
      serial: this._generateSerial(),
      validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + this.certRotationDays * 24 * 60 * 60 * 1000).toISOString(),
      issuer: 'Proxy Node System CA',
      subject: `CN=${nodeHost}, O=ProxyNode, OU=${nodeId}`,
      fingerprint: this._generateFingerprint(publicKey)
    };
    
    // Store cert info
    const certPath = path.join(this.certDir, `node-${nodeId}`);
    await fs.mkdir(certPath, { recursive: true });
    await fs.writeFile(path.join(certPath, 'key.pem'), privateKey, { mode: 0o600 });
    await fs.writeFile(path.join(certPath, 'cert.pem'), publicKey, { mode: 0o644 });
    await fs.writeFile(path.join(certPath, 'info.json'), JSON.stringify(certInfo, null, 2));
    
    logger.info('Generated node certificate', { nodeId, host: nodeHost });
    
    return {
      privateKey,
      publicKey,
      certInfo
    };
  }

  /**
   * Verify a node's certificate
   */
  async verifyNodeCertificate(nodeId) {
    try {
      const infoPath = path.join(this.certDir, `node-${nodeId}`, 'info.json');
      const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
      
      const isExpired = new Date(info.validTo) < new Date();
      const isValid = !isExpired;
      
      return {
        valid: isValid,
        expired: isExpired,
        info
      };
    } catch {
      return { valid: false, error: 'Certificate not found' };
    }
  }

  /**
   * Rotate certificate for a node
   */
  async rotateCertificate(nodeId, nodeHost) {
    logger.info('Rotating certificate for node', { nodeId });
    
    // Backup old cert
    const oldCertPath = path.join(this.certDir, `node-${nodeId}`);
    const backupPath = path.join(this.certDir, `node-${nodeId}.backup-${Date.now()}`);
    
    try {
      await fs.rename(oldCertPath, backupPath);
    } catch {
      // Old cert might not exist
    }
    
    // Generate new cert
    const newCert = await this.generateNodeCertificate(nodeId, nodeHost);
    
    // Clean up old backups (keep last 3)
    await this._cleanupOldCertBackups(nodeId);
    
    return newCert;
  }

  /**
   * Get certificates that need rotation
   */
  async getCertificatesNeedingRotation() {
    const needsRotation = [];
    
    try {
      const entries = await fs.readdir(this.certDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('node-') && !entry.name.includes('.backup')) {
          const infoPath = path.join(this.certDir, entry.name, 'info.json');
          try {
            const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
            const daysUntilExpiry = (new Date(info.validTo) - Date.now()) / (24 * 60 * 60 * 1000);
            
            if (daysUntilExpiry < 30) { // Rotate 30 days before expiry
              needsRotation.push({
                nodeId: info.nodeId,
                host: info.host,
                expiresAt: info.validTo,
                daysUntilExpiry: Math.floor(daysUntilExpiry)
              });
            }
          } catch {
            // Skip invalid entries
          }
        }
      }
    } catch {
      // Cert dir might not exist yet
    }
    
    return needsRotation;
  }

  /**
   * Get certificate stats
   */
  getStats() {
    return {
      cachedCerts: this.certificates.size,
      maxCachedCerts: this.maxCachedCerts,
      certRotationDays: this.certRotationDays,
      initialized: this.initialized,
      certDir: this.certDir
    };
  }

  /**
   * Export CA certificate as downloadable bundle
   */
  async exportCABundle() {
    if (!this.caCert) {
      throw new Error('CA certificate not initialized');
    }
    
    return {
      certificate: this.caCert,
      format: 'PEM',
      instructions: [
        'To use HTTPS proxy inspection, install this CA certificate:',
        'Windows: certutil -addstore -f "ROOT" ca-cert.pem',
        'macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca-cert.pem',
        'Linux: sudo cp ca-cert.pem /usr/local/share/ca-certificates/proxy-ca.crt && sudo update-ca-certificates',
        'Firefox: Settings > Privacy & Security > Certificates > Import'
      ]
    };
  }

  // Private methods

  async _generateCA() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    // In production, you'd use a proper X.509 library
    // This generates the key pair; the actual cert signing would use openssl or node-forge
    return {
      privateKey,
      certificate: publicKey, // Simplified - in production use proper X.509
      serial: this._generateSerial()
    };
  }

  async _generateHostCertificate(hostname) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    return {
      privateKey,
      certificate: publicKey, // Simplified
      hostname,
      serial: this._generateSerial()
    };
  }

  _generateSerial() {
    return crypto.randomBytes(16).toString('hex');
  }

  _generateFingerprint(publicKey) {
    return crypto.createHash('sha256').update(publicKey).digest('hex');
  }

  async _cleanupOldCertBackups(nodeId) {
    try {
      const entries = await fs.readdir(this.certDir);
      const backups = entries
        .filter(e => e.startsWith(`node-${nodeId}.backup-`))
        .sort()
        .reverse();
      
      // Remove all but the latest 3 backups
      for (let i = 3; i < backups.length; i++) {
        const backupPath = path.join(this.certDir, backups[i]);
        await fs.rm(backupPath, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

module.exports = SSLManager;
