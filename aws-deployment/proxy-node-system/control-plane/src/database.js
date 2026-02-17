const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

/**
 * Database Abstraction Layer
 * Provides a unified interface for data persistence
 * Supports SQLite-like file-based storage with JSON
 * Can be swapped for PostgreSQL/MySQL in production
 */
class Database {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.collections = new Map();
    this.indexes = new Map();
    this.transactions = [];
    this.initialized = false;
    this.writeQueue = new Map();
    this.flushInterval = options.flushInterval || 5000;
    this.maxMemoryItems = options.maxMemoryItems || 100000;
  }

  /**
   * Initialize the database
   */
  async initialize() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Load existing collections
      const files = await fs.readdir(this.dataDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const collectionName = file.replace('.json', '');
          await this._loadCollection(collectionName);
        }
      }
      
      // Start periodic flush
      this._flushTimer = setInterval(() => this._flushAll(), this.flushInterval);
      
      this.initialized = true;
      logger.info('Database initialized', { dataDir: this.dataDir, collections: this.collections.size });
    } catch (error) {
      logger.error('Failed to initialize database', { error: error.message });
      throw error;
    }
  }

  /**
   * Get or create a collection
   */
  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, {
        name,
        data: new Map(),
        dirty: false,
        indexes: new Map(),
        createdAt: Date.now()
      });
    }
    
    return new CollectionProxy(this, name);
  }

  /**
   * Insert a document
   */
  async insert(collectionName, doc) {
    const collection = this._getCollection(collectionName);
    
    const id = doc.id || doc._id || this._generateId();
    const document = {
      _id: id,
      ...doc,
      _createdAt: new Date().toISOString(),
      _updatedAt: new Date().toISOString()
    };
    
    collection.data.set(id, document);
    collection.dirty = true;
    
    // Update indexes
    this._updateIndexes(collectionName, document);
    
    this._scheduleFlush(collectionName);
    return document;
  }

  /**
   * Insert multiple documents
   */
  async insertMany(collectionName, docs) {
    const results = [];
    for (const doc of docs) {
      results.push(await this.insert(collectionName, doc));
    }
    return results;
  }

  /**
   * Find a document by ID
   */
  async findById(collectionName, id) {
    const collection = this._getCollection(collectionName);
    return collection.data.get(id) || null;
  }

  /**
   * Find documents matching a query
   */
  async find(collectionName, query = {}, options = {}) {
    const collection = this._getCollection(collectionName);
    let results = [...collection.data.values()];
    
    // Apply query filters
    if (Object.keys(query).length > 0) {
      results = results.filter(doc => this._matchQuery(doc, query));
    }
    
    // Apply sorting
    if (options.sort) {
      const sortField = Object.keys(options.sort)[0];
      const sortDir = options.sort[sortField];
      results.sort((a, b) => {
        if (a[sortField] < b[sortField]) return sortDir === 1 ? -1 : 1;
        if (a[sortField] > b[sortField]) return sortDir === 1 ? 1 : -1;
        return 0;
      });
    }
    
    // Apply pagination
    if (options.skip) {
      results = results.slice(options.skip);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }
    
    // Apply projection
    if (options.fields) {
      results = results.map(doc => {
        const projected = {};
        for (const field of options.fields) {
          if (doc[field] !== undefined) {
            projected[field] = doc[field];
          }
        }
        projected._id = doc._id;
        return projected;
      });
    }
    
    return results;
  }

  /**
   * Find one document matching a query
   */
  async findOne(collectionName, query = {}) {
    const results = await this.find(collectionName, query, { limit: 1 });
    return results[0] || null;
  }

  /**
   * Update a document
   */
  async update(collectionName, id, updates) {
    const collection = this._getCollection(collectionName);
    const doc = collection.data.get(id);
    
    if (!doc) {
      throw new Error(`Document ${id} not found in ${collectionName}`);
    }
    
    // Handle $set, $unset, $inc operators
    if (updates.$set) {
      Object.assign(doc, updates.$set);
    } else if (updates.$unset) {
      for (const field of Object.keys(updates.$unset)) {
        delete doc[field];
      }
    } else if (updates.$inc) {
      for (const [field, value] of Object.entries(updates.$inc)) {
        doc[field] = (doc[field] || 0) + value;
      }
    } else {
      // Direct update
      Object.assign(doc, updates);
    }
    
    doc._updatedAt = new Date().toISOString();
    collection.data.set(id, doc);
    collection.dirty = true;
    
    this._updateIndexes(collectionName, doc);
    this._scheduleFlush(collectionName);
    
    return doc;
  }

  /**
   * Update multiple documents matching a query
   */
  async updateMany(collectionName, query, updates) {
    const docs = await this.find(collectionName, query);
    const results = [];
    
    for (const doc of docs) {
      results.push(await this.update(collectionName, doc._id, updates));
    }
    
    return { matched: docs.length, modified: results.length };
  }

  /**
   * Delete a document
   */
  async delete(collectionName, id) {
    const collection = this._getCollection(collectionName);
    const existed = collection.data.delete(id);
    
    if (existed) {
      collection.dirty = true;
      this._scheduleFlush(collectionName);
    }
    
    return existed;
  }

  /**
   * Delete documents matching a query
   */
  async deleteMany(collectionName, query) {
    const docs = await this.find(collectionName, query);
    let deleted = 0;
    
    for (const doc of docs) {
      if (await this.delete(collectionName, doc._id)) {
        deleted++;
      }
    }
    
    return { deleted };
  }

  /**
   * Count documents matching a query
   */
  async count(collectionName, query = {}) {
    if (Object.keys(query).length === 0) {
      return this._getCollection(collectionName).data.size;
    }
    const results = await this.find(collectionName, query);
    return results.length;
  }

  /**
   * Aggregate data
   */
  async aggregate(collectionName, pipeline) {
    let data = await this.find(collectionName);
    
    for (const stage of pipeline) {
      if (stage.$match) {
        data = data.filter(doc => this._matchQuery(doc, stage.$match));
      }
      
      if (stage.$group) {
        data = this._groupBy(data, stage.$group);
      }
      
      if (stage.$sort) {
        const sortField = Object.keys(stage.$sort)[0];
        const sortDir = stage.$sort[sortField];
        data.sort((a, b) => {
          if (a[sortField] < b[sortField]) return sortDir === 1 ? -1 : 1;
          if (a[sortField] > b[sortField]) return sortDir === 1 ? 1 : -1;
          return 0;
        });
      }
      
      if (stage.$limit) {
        data = data.slice(0, stage.$limit);
      }
      
      if (stage.$skip) {
        data = data.slice(stage.$skip);
      }
      
      if (stage.$project) {
        data = data.map(doc => {
          const projected = {};
          for (const [key, include] of Object.entries(stage.$project)) {
            if (include && doc[key] !== undefined) {
              projected[key] = doc[key];
            }
          }
          return projected;
        });
      }
    }
    
    return data;
  }

  /**
   * Create an index on a collection field
   */
  async createIndex(collectionName, field, options = {}) {
    const collection = this._getCollection(collectionName);
    
    const index = {
      field,
      unique: options.unique || false,
      data: new Map()
    };
    
    // Build index from existing data
    for (const [id, doc] of collection.data) {
      const value = doc[field];
      if (value !== undefined) {
        if (!index.data.has(value)) {
          index.data.set(value, new Set());
        }
        index.data.get(value).add(id);
      }
    }
    
    collection.indexes.set(field, index);
    logger.info('Index created', { collection: collectionName, field });
    
    return index;
  }

  /**
   * Begin a transaction
   */
  beginTransaction() {
    const txId = this._generateId();
    const tx = {
      id: txId,
      operations: [],
      snapshots: new Map(),
      committed: false,
      rolledBack: false,
      createdAt: Date.now()
    };
    this.transactions.push(tx);
    return new TransactionProxy(this, tx);
  }

  /**
   * Get database statistics
   */
  getStats() {
    const stats = {
      collections: {},
      totalDocuments: 0,
      totalIndexes: 0,
      dataDir: this.dataDir,
      initialized: this.initialized
    };
    
    for (const [name, collection] of this.collections) {
      stats.collections[name] = {
        documents: collection.data.size,
        indexes: collection.indexes.size,
        dirty: collection.dirty,
        createdAt: new Date(collection.createdAt).toISOString()
      };
      stats.totalDocuments += collection.data.size;
      stats.totalIndexes += collection.indexes.size;
    }
    
    return stats;
  }

  /**
   * Drop a collection
   */
  async dropCollection(collectionName) {
    this.collections.delete(collectionName);
    
    try {
      await fs.unlink(path.join(this.dataDir, `${collectionName}.json`));
    } catch {
      // File might not exist
    }
    
    logger.info('Collection dropped', { collectionName });
  }

  /**
   * Export all data
   */
  async exportAll() {
    const exportData = {};
    
    for (const [name, collection] of this.collections) {
      exportData[name] = [...collection.data.values()];
    }
    
    return exportData;
  }

  /**
   * Import data
   */
  async importData(data) {
    for (const [collectionName, docs] of Object.entries(data)) {
      for (const doc of docs) {
        await this.insert(collectionName, doc);
      }
    }
  }

  /**
   * Shutdown and flush all data
   */
  async shutdown() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
    }
    await this._flushAll();
    logger.info('Database shutdown complete');
  }

  // Private methods

  _getCollection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, {
        name,
        data: new Map(),
        dirty: false,
        indexes: new Map(),
        createdAt: Date.now()
      });
    }
    return this.collections.get(name);
  }

  async _loadCollection(name) {
    try {
      const filepath = path.join(this.dataDir, `${name}.json`);
      const content = await fs.readFile(filepath, 'utf8');
      const docs = JSON.parse(content);
      
      const collection = this._getCollection(name);
      for (const doc of docs) {
        collection.data.set(doc._id || doc.id, doc);
      }
      
      logger.info('Collection loaded', { name, documents: collection.data.size });
    } catch (error) {
      logger.warn('Failed to load collection', { name, error: error.message });
    }
  }

  async _flushAll() {
    for (const [name, collection] of this.collections) {
      if (collection.dirty) {
        await this._flushCollection(name);
      }
    }
  }

  async _flushCollection(name) {
    const collection = this.collections.get(name);
    if (!collection) return;
    
    try {
      const data = [...collection.data.values()];
      const filepath = path.join(this.dataDir, `${name}.json`);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      collection.dirty = false;
    } catch (error) {
      logger.error('Failed to flush collection', { name, error: error.message });
    }
  }

  _scheduleFlush(collectionName) {
    if (!this.writeQueue.has(collectionName)) {
      this.writeQueue.set(collectionName, setTimeout(() => {
        this._flushCollection(collectionName);
        this.writeQueue.delete(collectionName);
      }, 1000));
    }
  }

  _matchQuery(doc, query) {
    for (const [key, condition] of Object.entries(query)) {
      const value = doc[key];
      
      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
        // Operator-based query
        if (condition.$eq !== undefined && value !== condition.$eq) return false;
        if (condition.$ne !== undefined && value === condition.$ne) return false;
        if (condition.$gt !== undefined && !(value > condition.$gt)) return false;
        if (condition.$gte !== undefined && !(value >= condition.$gte)) return false;
        if (condition.$lt !== undefined && !(value < condition.$lt)) return false;
        if (condition.$lte !== undefined && !(value <= condition.$lte)) return false;
        if (condition.$in !== undefined && !condition.$in.includes(value)) return false;
        if (condition.$nin !== undefined && condition.$nin.includes(value)) return false;
        if (condition.$regex !== undefined) {
          const regex = new RegExp(condition.$regex, condition.$options || '');
          if (!regex.test(value)) return false;
        }
        if (condition.$exists !== undefined) {
          if (condition.$exists && value === undefined) return false;
          if (!condition.$exists && value !== undefined) return false;
        }
      } else {
        // Direct equality
        if (value !== condition) return false;
      }
    }
    return true;
  }

  _groupBy(data, groupSpec) {
    const groups = new Map();
    const groupKey = groupSpec._id;
    
    for (const doc of data) {
      const key = typeof groupKey === 'string' && groupKey.startsWith('$') 
        ? doc[groupKey.slice(1)] 
        : groupKey;
      
      const keyStr = JSON.stringify(key);
      
      if (!groups.has(keyStr)) {
        groups.set(keyStr, { _id: key, _docs: [] });
      }
      groups.get(keyStr)._docs.push(doc);
    }
    
    // Apply aggregation operators
    const results = [];
    for (const [, group] of groups) {
      const result = { _id: group._id };
      
      for (const [field, op] of Object.entries(groupSpec)) {
        if (field === '_id') continue;
        
        if (op.$sum !== undefined) {
          if (typeof op.$sum === 'string' && op.$sum.startsWith('$')) {
            result[field] = group._docs.reduce((sum, doc) => sum + (doc[op.$sum.slice(1)] || 0), 0);
          } else {
            result[field] = group._docs.length * (op.$sum || 1);
          }
        }
        
        if (op.$avg !== undefined) {
          const fieldName = op.$avg.startsWith('$') ? op.$avg.slice(1) : op.$avg;
          const values = group._docs.map(d => d[fieldName]).filter(v => v !== undefined);
          result[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        }
        
        if (op.$min !== undefined) {
          const fieldName = op.$min.startsWith('$') ? op.$min.slice(1) : op.$min;
          result[field] = Math.min(...group._docs.map(d => d[fieldName]).filter(v => v !== undefined));
        }
        
        if (op.$max !== undefined) {
          const fieldName = op.$max.startsWith('$') ? op.$max.slice(1) : op.$max;
          result[field] = Math.max(...group._docs.map(d => d[fieldName]).filter(v => v !== undefined));
        }
        
        if (op.$count) {
          result[field] = group._docs.length;
        }
      }
      
      results.push(result);
    }
    
    return results;
  }

  _updateIndexes(collectionName, doc) {
    const collection = this._getCollection(collectionName);
    
    for (const [field, index] of collection.indexes) {
      const value = doc[field];
      if (value !== undefined) {
        if (!index.data.has(value)) {
          index.data.set(value, new Set());
        }
        index.data.get(value).add(doc._id);
      }
    }
  }

  _generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    const counter = (Database._counter = (Database._counter || 0) + 1).toString(36);
    return `${timestamp}${random}${counter}`;
  }
}

/**
 * Collection proxy for fluent API
 */
class CollectionProxy {
  constructor(db, collectionName) {
    this.db = db;
    this.name = collectionName;
  }
  
  async insert(doc) { return this.db.insert(this.name, doc); }
  async insertMany(docs) { return this.db.insertMany(this.name, docs); }
  async findById(id) { return this.db.findById(this.name, id); }
  async find(query, options) { return this.db.find(this.name, query, options); }
  async findOne(query) { return this.db.findOne(this.name, query); }
  async update(id, updates) { return this.db.update(this.name, id, updates); }
  async updateMany(query, updates) { return this.db.updateMany(this.name, query, updates); }
  async delete(id) { return this.db.delete(this.name, id); }
  async deleteMany(query) { return this.db.deleteMany(this.name, query); }
  async count(query) { return this.db.count(this.name, query); }
  async aggregate(pipeline) { return this.db.aggregate(this.name, pipeline); }
  async createIndex(field, options) { return this.db.createIndex(this.name, field, options); }
  async drop() { return this.db.dropCollection(this.name); }
}

/**
 * Transaction proxy for atomic operations
 */
class TransactionProxy {
  constructor(db, tx) {
    this.db = db;
    this.tx = tx;
  }
  
  async insert(collectionName, doc) {
    // Save snapshot for rollback
    const collection = this.db._getCollection(collectionName);
    if (!this.tx.snapshots.has(collectionName)) {
      this.tx.snapshots.set(collectionName, new Map(collection.data));
    }
    
    const result = await this.db.insert(collectionName, doc);
    this.tx.operations.push({ type: 'insert', collection: collectionName, id: result._id });
    return result;
  }
  
  async update(collectionName, id, updates) {
    const collection = this.db._getCollection(collectionName);
    if (!this.tx.snapshots.has(collectionName)) {
      this.tx.snapshots.set(collectionName, new Map(collection.data));
    }
    
    const result = await this.db.update(collectionName, id, updates);
    this.tx.operations.push({ type: 'update', collection: collectionName, id });
    return result;
  }
  
  async delete(collectionName, id) {
    const collection = this.db._getCollection(collectionName);
    if (!this.tx.snapshots.has(collectionName)) {
      this.tx.snapshots.set(collectionName, new Map(collection.data));
    }
    
    const result = await this.db.delete(collectionName, id);
    this.tx.operations.push({ type: 'delete', collection: collectionName, id });
    return result;
  }
  
  async commit() {
    this.tx.committed = true;
    logger.info('Transaction committed', { txId: this.tx.id, operations: this.tx.operations.length });
    return { committed: true, operations: this.tx.operations.length };
  }
  
  async rollback() {
    // Restore snapshots
    for (const [collectionName, snapshot] of this.tx.snapshots) {
      const collection = this.db._getCollection(collectionName);
      collection.data = snapshot;
      collection.dirty = true;
    }
    
    this.tx.rolledBack = true;
    logger.info('Transaction rolled back', { txId: this.tx.id, operations: this.tx.operations.length });
    return { rolledBack: true, operations: this.tx.operations.length };
  }
}

module.exports = Database;
