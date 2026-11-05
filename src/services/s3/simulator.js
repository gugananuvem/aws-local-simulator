/**
 * S3 Simulator Core
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");
const PresignedUrlGenerator = require("./presigned-url-generator");

class S3Simulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR || './.aws-local-simulator-data', "s3");
    this.store = new LocalStore(this.dataDir);
    this.buckets = new Map();
    this.directoryBuckets = new Map();
    this.tableBuckets = new Map();
    this.vectorBuckets = new Map();
    this.vectorIndexes = new Map();
    this.accessPoints = new Map();
    this.fileSystems = new Map();
    this.accessGrants = new Map();
    this.storageLensConfigs = new Map();
    this.batchJobs = new Map();
    this.audit = new CloudTrailAudit("s3.amazonaws.com");
    this.lambdaService = null;
    this.snsService = null;
    this.sqsService = null;
    this.eventbridgeService = null;
    this.region = "us-east-1";
    this.accountId = "000000000000";
    this.presignedUrlGenerator = new PresignedUrlGenerator(config);
  }

  setLambdaService(service) { this.lambdaService = service; }
  setSnsService(service) { this.snsService = service; }
  setSqsService(service) { this.sqsService = service; }
  setEventbridgeService(service) { this.eventbridgeService = service; }

  async initialize() {
    logger.debug("Inicializando S3 Simulator...");
    this.loadBuckets();
    this._loadExtended();
    logger.debug(`✅ S3 Simulator inicializado com ${this.buckets.size} buckets`);
  }

  _loadExtended() {
    const dirBuckets = this.store.read("__directory_buckets__");
    if (dirBuckets && typeof dirBuckets === 'object') {
      for (const [name, data] of Object.entries(dirBuckets)) {
        this.directoryBuckets.set(name, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const tableBuckets = this.store.read("__table_buckets__");
    if (tableBuckets && typeof tableBuckets === 'object') {
      for (const [name, data] of Object.entries(tableBuckets)) {
        this.tableBuckets.set(name, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const vectorBuckets = this.store.read("__vector_buckets__");
    if (vectorBuckets && typeof vectorBuckets === 'object') {
      for (const [name, data] of Object.entries(vectorBuckets)) {
        this.vectorBuckets.set(name, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const vectorIndexes = this.store.read("__vector_indexes__");
    if (vectorIndexes && typeof vectorIndexes === 'object') {
      for (const [key, data] of Object.entries(vectorIndexes)) {
        this.vectorIndexes.set(key, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const accessPoints = this.store.read("__access_points__");
    if (accessPoints && typeof accessPoints === 'object') {
      for (const [name, data] of Object.entries(accessPoints)) {
        this.accessPoints.set(name, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const fileSystems = this.store.read("__file_systems__");
    if (fileSystems && typeof fileSystems === 'object') {
      for (const [id, data] of Object.entries(fileSystems)) {
        this.fileSystems.set(id, { ...data, creationDate: data.creationDate ? new Date(data.creationDate) : new Date() });
      }
    }
    const accessGrants = this.store.read("__access_grants__");
    if (accessGrants && typeof accessGrants === 'object') {
      for (const [id, data] of Object.entries(accessGrants)) {
        this.accessGrants.set(id, data);
      }
    }
    const storageLens = this.store.read("__storage_lens__");
    if (storageLens && typeof storageLens === 'object') {
      for (const [id, data] of Object.entries(storageLens)) {
        this.storageLensConfigs.set(id, data);
      }
    }
    const batchJobs = this.store.read("__batch_jobs__");
    if (batchJobs && typeof batchJobs === 'object') {
      for (const [id, data] of Object.entries(batchJobs)) {
        this.batchJobs.set(id, data);
      }
    }
  }

  loadBuckets() {
    const savedBuckets = this.store.read("__buckets__");
    if (savedBuckets && typeof savedBuckets === "object" && !Array.isArray(savedBuckets)) {
      for (const [name, data] of Object.entries(savedBuckets)) {
        if (!this.buckets.has(name)) {
          const objects = new Map();
          for (const [key, meta] of Object.entries(data.objects || {})) {
            objects.set(key, {
              key: meta.key,
              size: meta.size,
              etag: meta.etag,
              contentType: meta.contentType,
              metadata: meta.metadata,
              lastModified: new Date(meta.lastModified),
            });
          }
          this.buckets.set(name, {
            name,
            region: data.region || "us-east-1",
            arn: data.arn || `arn:aws:s3:::${name}`,
            website: !!(data.websiteConfiguration),
            websiteConfiguration: data.websiteConfiguration || null,
            creationDate: new Date(data.creationDate),
            objects,
            objectCount: data.objectCount || 0,
            totalSize: data.totalSize || 0,
            encryptionConfiguration: data.encryptionConfiguration || { sseType: "AES256" },
            tags: data.tags || {},
            versioning: data.versioning || "Suspended",
            publicAccessBlock: data.publicAccessBlock || {
              BlockPublicAcls: data.blockPublicAccess !== false,
              IgnorePublicAcls: data.blockPublicAccess !== false,
              BlockPublicPolicy: data.blockPublicAccess !== false,
              RestrictPublicBuckets: data.blockPublicAccess !== false,
            },
            blockPublicAccess: data.blockPublicAccess === undefined ? true : !!data.blockPublicAccess,
            objectOwnership: data.objectOwnership || "BucketOwnerEnforced",
            notificationConfiguration: data.notificationConfiguration || null,
          });
        }
      }
    }

    // Cria buckets definidos na config que ainda não existem
    if (this.config.s3?.buckets) {
      for (const bucketDef of this.config.s3.buckets) {
        // suporta string simples ou objeto { name, region, websiteConfiguration, notificationConfiguration }
        const bucketName     = typeof bucketDef === "string" ? bucketDef : bucketDef.name;
        const region         = typeof bucketDef === "object" ? (bucketDef.region || "us-east-1") : "us-east-1";
        const websiteConfig  = typeof bucketDef === "object" ? (bucketDef.websiteConfiguration || null) : null;
        const notificationConfig = typeof bucketDef === "object" ? (bucketDef.notificationConfiguration || null) : null;

        if (!this.buckets.has(bucketName)) {
          this.createBucket(bucketName, { region, websiteConfiguration: websiteConfig, notificationConfiguration: notificationConfig });
        }
      }
    }
  }

  // ─── Helpers de conteúdo em arquivo ───────────────────────────────────────

  _objectFilePath(bucketName, key) {
    const safePath = key.split("/").map((part) =>
      part.replace(/[<>:"|?*\\]/g, "_")
    ).join(path.sep);
    return path.join(this.dataDir, bucketName, safePath);
  }

  _writeObjectContent(bucketName, key, content) {
    const filePath = this._objectFilePath(bucketName, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      require("mkdirp").sync(dir);
    }
    fs.writeFileSync(filePath, content);
  }

  _readObjectContent(bucketName, key) {
    const filePath = this._objectFilePath(bucketName, key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  _deleteObjectContent(bucketName, key) {
    const filePath = this._objectFilePath(bucketName, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // ─── Buckets ──────────────────────────────────────────────────────────────

  createBucket(bucketName, options = {}) {
    if (!this.isValidBucketName(bucketName)) {
      return { error: { code: "InvalidBucketName", message: "Bucket name is invalid" }, status: 400 };
    }

    if (this._bucketNameExists(bucketName)) {
      return { error: { code: "BucketAlreadyExists", message: "Bucket already exists" }, status: 409 };
    }

    const { region = "us-east-1", websiteConfiguration = null, notificationConfiguration = null } = options;

    const encryption = this._normalizeEncryption(options.encryptionConfiguration || options.encryption);
    if (encryption.error) return { error: encryption.error, status: 400 };

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const versioningValue = options.versioning ?? options.Versioning;
    const versioning =
      versioningValue === true || versioningValue === "Enabled" ? "Enabled" : "Suspended";
    const blockPublicAccess =
      options.blockPublicAccess === undefined && options.BlockPublicAccess === undefined
        ? undefined
        : options.blockPublicAccess ?? options.BlockPublicAccess;
    const publicAccessBlock = this._normalizePublicAccessBlock(
      options.publicAccessBlock || options.PublicAccessBlock,
      blockPublicAccess
    );
    const objectOwnership = options.objectOwnership || options.ObjectOwnership || "BucketOwnerEnforced";

    const bucket = {
      name: bucketName,
      region,
      arn: `arn:aws:s3:::${bucketName}`,
      website: !!websiteConfiguration,
      websiteConfiguration: websiteConfiguration
        ? {
            IndexDocument: { Suffix: websiteConfiguration.IndexDocument?.Suffix || "index.html" },
            ErrorDocument: { Key: websiteConfiguration.ErrorDocument?.Key || "error.html" },
          }
        : null,
      creationDate: new Date(),
      objects: new Map(),
      objectCount: 0,
      totalSize: 0,
      encryptionConfiguration: encryption.value,
      tags: tags.value,
      versioning,
      publicAccessBlock: publicAccessBlock.value,
      blockPublicAccess: Object.values(publicAccessBlock.value).every(Boolean),
      objectOwnership,
      notificationConfiguration: this._normalizeNotificationConfig(notificationConfiguration),
      policy: null, // Bucket policy para controle de acesso
    };

    this.buckets.set(bucketName, bucket);
    this.persistBuckets();
    logger.debug(`✅ Bucket S3 criado: ${bucketName} (region: ${region}${websiteConfiguration ? ", website: enabled" : ""}${bucket.notificationConfiguration ? ", notifications: enabled" : ""})`);
    this.audit.record({ eventName: "CreateBucket", readOnly: false, resources: [{ ARN: `arn:aws:s3:::${bucketName}`, type: "AWS::S3::Bucket" }], requestParameters: { bucketName } });
    return { bucket };
  }

  deleteBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    if (bucket.objects.size > 0) {
      return { error: { code: "BucketNotEmpty", message: "Bucket is not empty" }, status: 409 };
    }
    this.buckets.delete(bucketName);
    this.store.delete(bucketName);
    this.persistBuckets();
    logger.debug(`🗑️ Bucket S3 deletado: ${bucketName}`);
    this.audit.record({ eventName: "DeleteBucket", readOnly: false, resources: [{ ARN: `arn:aws:s3:::${bucketName}`, type: "AWS::S3::Bucket" }] });
    return { success: true };
  }

  /**
   * Definir política do bucket (bucket policy)
   * Controla quem pode acessar o bucket e seus objetos
   */
  putBucketPolicy(bucketName, policy) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    try {
      // Validar que é um JSON válido
      const policyObject = typeof policy === 'string' ? JSON.parse(policy) : policy;
      
      if (!policyObject.Statement || !Array.isArray(policyObject.Statement)) {
        return { error: { code: "InvalidPolicyDocument", message: "Invalid bucket policy" }, status: 400 };
      }

      bucket.policy = policyObject;
      this.persistBuckets();
      
      logger.debug(`📋 Política de bucket definida: ${bucketName}`);
      this.audit.record({ 
        eventName: "PutBucketPolicy", 
        readOnly: false, 
        resources: [{ ARN: `arn:aws:s3:::${bucketName}`, type: "AWS::S3::Bucket" }],
        requestParameters: { bucketName, policy: policyObject }
      });
      
      return { success: true };
    } catch (error) {
      return { error: { code: "InvalidPolicyDocument", message: error.message }, status: 400 };
    }
  }

  /**
   * Obter política do bucket
   */
  getBucketPolicy(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    if (!bucket.policy) {
      return { error: { code: "NoSuchBucketPolicy", message: "The bucket policy does not exist" }, status: 404 };
    }

    return {
      policy: bucket.policy,
      status: 200
    };
  }

  /**
   * Deletar política do bucket
   */
  deleteBucketPolicy(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    bucket.policy = null;
    this.persistBuckets();
    
    logger.debug(`🗑️ Política de bucket deletada: ${bucketName}`);
    this.audit.record({ 
      eventName: "DeleteBucketPolicy", 
      readOnly: false, 
      resources: [{ ARN: `arn:aws:s3:::${bucketName}`, type: "AWS::S3::Bucket" }]
    });
    
    return { success: true };
  }

  listBuckets() {
    return Array.from(this.buckets.values()).map((bucket) => ({
      Name: bucket.name,
      CreationDate: bucket.creationDate.toISOString(),
    }));
  }

  getBucketsInfo() {
    return Array.from(this.buckets.values()).map((bucket) => ({
      name: bucket.name,
      region: bucket.region,
      arn: bucket.arn || `arn:aws:s3:::${bucket.name}`,
      website: bucket.website,
      creationDate: bucket.creationDate,
      objectCount: bucket.objectCount,
      totalSize: bucket.totalSize,
      encryptionConfiguration: bucket.encryptionConfiguration || { sseType: "AES256" },
      tags: bucket.tags || {},
      versioning: bucket.versioning || "Suspended",
      blockPublicAccess: bucket.blockPublicAccess !== false,
      publicAccessBlock: bucket.publicAccessBlock || {
        BlockPublicAcls: bucket.blockPublicAccess !== false,
        IgnorePublicAcls: bucket.blockPublicAccess !== false,
        BlockPublicPolicy: bucket.blockPublicAccess !== false,
        RestrictPublicBuckets: bucket.blockPublicAccess !== false,
      },
      objectOwnership: bucket.objectOwnership || "BucketOwnerEnforced",
    }));
  }

  getBucketInfo(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket not found" } };
    }
    return {
      name: bucket.name,
      region: bucket.region,
      arn: bucket.arn || `arn:aws:s3:::${bucket.name}`,
      website: bucket.website,
      websiteConfiguration: bucket.websiteConfiguration,
      notificationConfiguration: bucket.notificationConfiguration,
      creationDate: bucket.creationDate,
      objectCount: bucket.objectCount,
      totalSize: bucket.totalSize,
      encryptionConfiguration: bucket.encryptionConfiguration || { sseType: "AES256" },
      tags: bucket.tags || {},
      versioning: bucket.versioning || "Suspended",
      blockPublicAccess: bucket.blockPublicAccess !== false,
      publicAccessBlock: bucket.publicAccessBlock || {
        BlockPublicAcls: bucket.blockPublicAccess !== false,
        IgnorePublicAcls: bucket.blockPublicAccess !== false,
        BlockPublicPolicy: bucket.blockPublicAccess !== false,
        RestrictPublicBuckets: bucket.blockPublicAccess !== false,
      },
      objectOwnership: bucket.objectOwnership || "BucketOwnerEnforced",
      objects: Array.from(bucket.objects.values())
        .slice(0, 20)
        .map((obj) => ({
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          lastModified: obj.lastModified,
        })),
    };
  }

  getBucket(bucketName) {
    return this.buckets.get(bucketName);
  }

  _generalBucketToJson(bucket) {
    return {
      Name: bucket.name,
      ARN: bucket.arn || `arn:aws:s3:::${bucket.name}`,
      Region: bucket.region,
      Status: "Active",
      CreationDate: bucket.creationDate?.toISOString?.() || new Date().toISOString(),
      EncryptionConfiguration: bucket.encryptionConfiguration || { sseType: "AES256" },
      Tags: bucket.tags || {},
      Versioning: bucket.versioning || "Suspended",
      BlockPublicAccess: bucket.blockPublicAccess !== false,
      PublicAccessBlock: bucket.publicAccessBlock,
      ObjectOwnership: bucket.objectOwnership || "BucketOwnerEnforced",
    };
  }

  getBucketsCount() {
    return this.buckets.size;
  }

  getTotalObjectsCount() {
    let total = 0;
    for (const bucket of this.buckets.values()) {
      total += bucket.objectCount;
    }
    return total;
  }

  clearBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (bucket) {
      for (const key of bucket.objects.keys()) {
        this._deleteObjectContent(bucketName, key);
      }
      bucket.objects.clear();
      bucket.objectCount = 0;
      bucket.totalSize = 0;
      this.persistBucket(bucketName);
    }
  }

  // ─── Objects ──────────────────────────────────────────────────────────────

  putObject(bucketName, key, content, headers) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    let body = content;
    if (Buffer.isBuffer(content)) {
      body = content;
    } else if (typeof content === "object") {
      body = Buffer.from(JSON.stringify(content));
    } else if (typeof content === "string") {
      body = Buffer.from(content);
    }

    const contentType = headers["content-type"] || "application/octet-stream";
    const metadata = this.extractMetadata(headers);
    const etag = crypto.createHash("md5").update(body).digest("hex");

    const oldObject = bucket.objects.get(key);
    if (oldObject) {
      bucket.totalSize -= oldObject.size;
    } else {
      bucket.objectCount++;
    }

    // Apenas metadados no Map — conteúdo vai para arquivo
    bucket.objects.set(key, {
      key,
      size: body.length,
      etag,
      contentType,
      metadata,
      lastModified: new Date(),
    });
    bucket.totalSize += body.length;

    this._writeObjectContent(bucketName, key, body);
    this.persistBucket(bucketName);

    logger.verboso(`📤 Upload S3: ${bucketName}/${key} (${body.length} bytes)`);
    this.audit.record({ eventName: "PutObject", readOnly: false, isDataEvent: true, resources: [{ ARN: `arn:aws:s3:::${bucketName}/${key}`, type: "AWS::S3::Object" }], requestParameters: { bucketName, key, contentType }, responseElements: { etag } });

    this._triggerS3Event(bucketName, key, {
      eventName: oldObject ? "ObjectCreated:Put" : "ObjectCreated:Put",
      eventType: "ObjectCreated",
      objectInfo: {
        key,
        size: body.length,
        etag,
        contentType,
        metadata,
        sequencer: crypto.randomBytes(8).toString("hex").toUpperCase(),
      },
    });

    return { etag };
  }

  getObject(bucketName, key, headers) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    const object = bucket.objects.get(key);
    if (!object) {
      return { error: { code: "NoSuchKey", message: "The specified key does not exist" }, status: 404 };
    }

    let content = this._readObjectContent(bucketName, key);
    if (!content) {
      return { error: { code: "NoSuchKey", message: "Object content not found on disk" }, status: 404 };
    }

    if (headers && headers.range) {
      const range = headers.range.match(/bytes=(\d+)-(\d+)?/);
      if (range) {
        const start = parseInt(range[1], 10);
        const end = range[2] ? parseInt(range[2], 10) : content.length - 1;
        content = content.subarray(start, end + 1);
      }
    }

    const result = {
      content,
      etag: object.etag,
      lastModified: object.lastModified.toUTCString(),
      contentType: object.contentType,
      size: content.length,
      metadata: object.metadata,
    };
    this.audit.record({ eventName: "GetObject", readOnly: true, isDataEvent: true, resources: [{ ARN: `arn:aws:s3:::${bucketName}/${key}`, type: "AWS::S3::Object" }], requestParameters: { bucketName, key } });
    return result;
  }

  headObject(bucketName, key) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    const object = bucket.objects.get(key);
    if (!object) {
      return { error: { code: "NoSuchKey", message: "Key does not exist" }, status: 404 };
    }
    return {
      etag: object.etag,
      lastModified: object.lastModified.toUTCString(),
      contentType: object.contentType,
      size: object.size,
    };
  }

  deleteObject(bucketName, key) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    const object = bucket.objects.get(key);
    if (object) {
      bucket.objects.delete(key);
      bucket.objectCount--;
      bucket.totalSize -= object.size;
      this._deleteObjectContent(bucketName, key);
      this.persistBucket(bucketName);
      logger.verboso(`🗑️ Delete S3: ${bucketName}/${key}`);
      this.audit.record({ eventName: "DeleteObject", readOnly: false, isDataEvent: true, resources: [{ ARN: `arn:aws:s3:::${bucketName}/${key}`, type: "AWS::S3::Object" }], requestParameters: { bucketName, key } });

      this._triggerS3Event(bucketName, key, {
        eventName: "ObjectRemoved:Delete",
        eventType: "ObjectRemoved",
        objectInfo: {
          key,
          size: object.size,
          etag: object.etag,
          contentType: object.contentType,
          metadata: object.metadata,
          sequencer: crypto.randomBytes(8).toString("hex").toUpperCase(),
        },
      });
    }
    return { success: true };
  }

  listObjects(bucketName, options = {}) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    const { prefix = "", delimiter, maxKeys = 1000 } = options;
    let objects = Array.from(bucket.objects.values())
      .filter((obj) => obj.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));

    const commonPrefixes = new Set();
    if (delimiter) {
      const filteredObjects = [];
      for (const obj of objects) {
        const afterPrefix = obj.key.substring(prefix.length);
        const delimiterIndex = afterPrefix.indexOf(delimiter);
        if (delimiterIndex !== -1) {
          commonPrefixes.add(prefix + afterPrefix.substring(0, delimiterIndex + 1));
        } else {
          filteredObjects.push(obj);
        }
      }
      objects = filteredObjects;
    }

    const contents = objects.slice(0, maxKeys).map((obj) => ({
      Key: obj.key,
      LastModified: obj.lastModified.toISOString(),
      ETag: `"${obj.etag}"`,
      Size: obj.size,
      StorageClass: "STANDARD",
    }));

    return {
      name: bucketName,
      prefix,
      maxKeys,
      isTruncated: objects.length > maxKeys,
      contents,
      commonPrefixes: Array.from(commonPrefixes),
    };
  }

  listAllObjects(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) return [];
    return Array.from(bucket.objects.values()).map((obj) => ({
      key: obj.key,
      size: obj.size,
      etag: obj.etag,
      lastModified: obj.lastModified,
    }));
  }

  // ─── Notification Configuration ───────────────────────────────────────────

  _normalizeNotificationConfig(config) {
    if (!config) return null;
    const normalized = {
      LambdaFunctionConfigurations: [],
      QueueConfigurations: [],
      TopicConfigurations: [],
    };
    const validEvents = [
      "s3:ObjectCreated:*",
      "s3:ObjectCreated:Put",
      "s3:ObjectCreated:Post",
      "s3:ObjectCreated:Copy",
      "s3:ObjectCreated:CompleteMultipartUpload",
      "s3:ObjectRemoved:*",
      "s3:ObjectRemoved:Delete",
      "s3:ObjectRemoved:DeleteMarkerCreated",
      "s3:ObjectRestore:*",
      "s3:ObjectRestore:Post",
      "s3:ObjectRestore:Completed",
      "s3:ReducedRedundancyLostObject",
      "s3:Replication:*",
      "s3:Replication:OperationFailedReplication",
      "s3:Replication:OperationNotTracked",
      "s3:Replication:OperationMissedThreshold",
      "s3:Replication:OperationReplicatedAfterThreshold",
      "s3:LifecycleExpiration:*",
      "s3:LifecycleExpiration:Delete",
      "s3:LifecycleExpiration:DeleteMarkerCreated",
      "s3:LifecycleTransition",
      "s3:IntelligentTiering",
      "s3:ObjectTagging:*",
      "s3:ObjectTagging:Put",
      "s3:ObjectTagging:Delete",
      "s3:ObjectAcl:Put",
    ];

    if (Array.isArray(config.LambdaFunctionConfigurations)) {
      for (const cfg of config.LambdaFunctionConfigurations) {
        if (!cfg.LambdaFunctionArn) continue;
        normalized.LambdaFunctionConfigurations.push({
          Id: cfg.Id || crypto.randomUUID(),
          LambdaFunctionArn: cfg.LambdaFunctionArn,
          Events: cfg.Events?.filter((e) => validEvents.includes(e)) || ["s3:ObjectCreated:*"],
          Filter: this._normalizeFilter(cfg.Filter),
        });
      }
    }
    if (Array.isArray(config.QueueConfigurations)) {
      for (const cfg of config.QueueConfigurations) {
        if (!cfg.QueueArn) continue;
        normalized.QueueConfigurations.push({
          Id: cfg.Id || crypto.randomUUID(),
          QueueArn: cfg.QueueArn,
          Events: cfg.Events?.filter((e) => validEvents.includes(e)) || ["s3:ObjectCreated:*"],
          Filter: this._normalizeFilter(cfg.Filter),
        });
      }
    }
    if (Array.isArray(config.TopicConfigurations)) {
      for (const cfg of config.TopicConfigurations) {
        if (!cfg.TopicArn) continue;
        normalized.TopicConfigurations.push({
          Id: cfg.Id || crypto.randomUUID(),
          TopicArn: cfg.TopicArn,
          Events: cfg.Events?.filter((e) => validEvents.includes(e)) || ["s3:ObjectCreated:*"],
          Filter: this._normalizeFilter(cfg.Filter),
        });
      }
    }

    const hasAny =
      normalized.LambdaFunctionConfigurations.length > 0 ||
      normalized.QueueConfigurations.length > 0 ||
      normalized.TopicConfigurations.length > 0;
    return hasAny ? normalized : null;
  }

  _normalizeFilter(filter) {
    if (!filter || !filter.Key) return null;
    const rules = [];
    if (Array.isArray(filter.Key.FilterRules)) {
      for (const r of filter.Key.FilterRules) {
        if (r.Name === "prefix" || r.Name === "suffix") {
          rules.push({ Name: r.Name, Value: r.Value });
        }
      }
    }
    return rules.length > 0 ? { Key: { FilterRules: rules } } : null;
  }

  _matchesFilter(filter, key) {
    if (!filter || !filter.Key || !Array.isArray(filter.Key.FilterRules)) return true;
    for (const rule of filter.Key.FilterRules) {
      const val = rule.Value || "";
      if (rule.Name === "prefix" && !key.startsWith(val)) return false;
      if (rule.Name === "suffix" && !key.endsWith(val)) return false;
    }
    return true;
  }

  _matchesEvent(configuredEvents, eventName, eventType) {
    if (!Array.isArray(configuredEvents) || configuredEvents.length === 0) return true;
    const s3EventName = `s3:${eventName}`;
    const s3EventType = `s3:${eventType}:*`;
    for (const ev of configuredEvents) {
      if (ev === s3EventName) return true;
      if (ev === s3EventType) return true;
      if (ev === "s3:ObjectCreated:*" && eventType === "ObjectCreated") return true;
      if (ev === "s3:ObjectRemoved:*" && eventType === "ObjectRemoved") return true;
    }
    return false;
  }

  _buildS3EventRecord(bucketName, key, ctx) {
    const bucket = this.buckets.get(bucketName);
    const region = bucket?.region || this.region;
    const info = ctx.objectInfo || {};
    return {
      eventVersion: "2.1",
      eventSource: "aws:s3",
      awsRegion: region,
      eventTime: new Date().toISOString(),
      eventName: ctx.eventName,
      userIdentity: { principalId: "AWSLocalSimulator" },
      requestParameters: { sourceIPAddress: "127.0.0.1" },
      responseElements: {
        "x-amz-request-id": crypto.randomUUID(),
        "x-amz-id-2": crypto.randomBytes(24).toString("base64"),
      },
      s3: {
        s3SchemaVersion: "1.0",
        configurationId: ctx.configId || "bucket-notification-config",
        bucket: {
          name: bucketName,
          ownerIdentity: { principalId: "AIDAJDPLRKLG7UEXAMPLE" },
          arn: `arn:aws:s3:::${bucketName}`,
        },
        object: {
          key: encodeURIComponent(key),
          size: info.size || 0,
          eTag: info.etag ? `"${info.etag}"` : undefined,
          versionId: undefined,
          sequencer: info.sequencer || crypto.randomBytes(8).toString("hex").toUpperCase(),
        },
      },
    };
  }

  async _triggerS3Event(bucketName, key, ctx) {
    try {
      const bucket = this.buckets.get(bucketName);
      if (!bucket) return;

      const record = this._buildS3EventRecord(bucketName, key, ctx);
      const s3EventPayload = { Records: [record] };

      if (bucket.notificationConfiguration) {
        for (const cfg of bucket.notificationConfiguration.LambdaFunctionConfigurations || []) {
          if (!this._matchesEvent(cfg.Events, ctx.eventName, ctx.eventType)) continue;
          if (!this._matchesFilter(cfg.Filter, key)) continue;
          record.s3.configurationId = cfg.Id;
          this._deliverToLambda(cfg.LambdaFunctionArn, { Records: [this._buildS3EventRecord(bucketName, key, { ...ctx, configId: cfg.Id })] });
        }
        for (const cfg of bucket.notificationConfiguration.QueueConfigurations || []) {
          if (!this._matchesEvent(cfg.Events, ctx.eventName, ctx.eventType)) continue;
          if (!this._matchesFilter(cfg.Filter, key)) continue;
          this._deliverToSQS(cfg.QueueArn, { Records: [this._buildS3EventRecord(bucketName, key, { ...ctx, configId: cfg.Id })] });
        }
        for (const cfg of bucket.notificationConfiguration.TopicConfigurations || []) {
          if (!this._matchesEvent(cfg.Events, ctx.eventName, ctx.eventType)) continue;
          if (!this._matchesFilter(cfg.Filter, key)) continue;
          this._deliverToSNS(cfg.TopicArn, { Records: [this._buildS3EventRecord(bucketName, key, { ...ctx, configId: cfg.Id })] });
        }
      }

      this._deliverToEventBridge(bucketName, ctx, s3EventPayload);
    } catch (err) {
      logger.warn(`S3 Event trigger error (${bucketName}/${key}): ${err.message}`);
    }
  }

  _deliverToLambda(functionArn, event) {
    if (!this.lambdaService?.simulator) return;
    try {
      const match = functionArn.match(/function:([^:]+)/);
      const functionName = match ? match[1] : functionArn;
      this.lambdaService.simulator.invokeFunction(functionName, event);
      logger.verboso(`📡 S3 → Lambda: ${functionArn}`);
    } catch (err) {
      logger.error(`❌ S3 → Lambda delivery failed: ${err.message}`);
    }
  }

  _deliverToSQS(queueArn, event) {
    if (!this.sqsService?.simulator) return;
    try {
      const match = queueArn.match(/:([^:]+)$/);
      const queueName = match ? match[1] : queueArn;
      const queue = this.sqsService.simulator.queues?.get(queueName);
      const queueUrl = queue?.url || queueArn;
      this.sqsService.simulator.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(event),
      });
      logger.verboso(`📡 S3 → SQS: ${queueArn}`);
    } catch (err) {
      logger.error(`❌ S3 → SQS delivery failed: ${err.message}`);
    }
  }

  _deliverToSNS(topicArn, event) {
    if (!this.snsService?.simulator) return;
    try {
      this.snsService.simulator.publish({
        TopicArn: topicArn,
        Message: JSON.stringify(event),
      });
      logger.verboso(`📡 S3 → SNS: ${topicArn}`);
    } catch (err) {
      logger.error(`❌ S3 → SNS delivery failed: ${err.message}`);
    }
  }

  _deliverToEventBridge(bucketName, ctx, s3EventPayload) {
    if (!this.eventbridgeService?.simulator) return;
    try {
      const bucket = this.buckets.get(bucketName);
      const region = bucket?.region || this.region;
      const objectKey = ctx.objectInfo?.key;
      const detailType = ctx.eventType === "ObjectCreated"
        ? "Object Created"
        : ctx.eventType === "ObjectRemoved"
          ? "Object Deleted"
          : ctx.eventName;
      const resources = [
        `arn:aws:s3:::${bucketName}`,
      ];
      if (objectKey) {
        resources.push(`arn:aws:s3:::${bucketName}/${objectKey}`);
      }
      this.eventbridgeService.simulator.putEvents({
        Entries: [{
          Time: new Date().toISOString(),
          Source: "aws.s3",
          Resources: resources,
          DetailType: detailType,
          Detail: JSON.stringify({
            version: "0",
            bucket: { name: bucketName },
            object: {
              key: objectKey,
              size: ctx.objectInfo?.size,
              etag: ctx.objectInfo?.etag,
              "version-id": ctx.objectInfo?.versionId,
              sequencer: ctx.objectInfo?.sequencer,
            },
            "request-id": crypto.randomUUID(),
            requester: this.accountId,
            "source-ip-address": "127.0.0.1",
            reason: ctx.eventName,
          }),
          EventBusName: "default",
        }],
      });
      logger.verboso(`📡 S3 → EventBridge (${detailType})`);
    } catch (err) {
      logger.error(`❌ S3 → EventBridge delivery failed: ${err.message}`);
    }
  }

  getBucketNotificationConfiguration(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    const nc = bucket.notificationConfiguration || {
      LambdaFunctionConfigurations: [],
      QueueConfigurations: [],
      TopicConfigurations: [],
    };
    return { notificationConfiguration: nc };
  }

  putBucketNotificationConfiguration(bucketName, config) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    bucket.notificationConfiguration = this._normalizeNotificationConfig(config);
    this.persistBuckets();
    logger.debug(`📢 Notification config atualizada: ${bucketName}`);
    return { success: true };
  }

  // ─── Website Config ───────────────────────────────────────────────────────

  getWebsiteConfig(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    if (!bucket.websiteConfiguration) {
      return { error: { code: "NoSuchWebsiteConfiguration", message: "The specified bucket does not have a website configuration" }, status: 404 };
    }
    return { websiteConfiguration: bucket.websiteConfiguration };
  }

  putWebsiteConfig(bucketName, config) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    bucket.website = true;
    bucket.websiteConfiguration = {
      IndexDocument: { Suffix: config.IndexDocument?.Suffix || "index.html" },
      ErrorDocument: { Key: config.ErrorDocument?.Key || "error.html" },
    };
    this.persistBuckets();
    logger.debug(`🌐 Website config atualizada: ${bucketName}`);
    return { success: true };
  }

  deleteWebsiteConfig(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }
    bucket.website = false;
    bucket.websiteConfiguration = null;
    this.persistBuckets();
    logger.debug(`🗑️ Website config removida: ${bucketName}`);
    return { success: true };
  }

  // ─── Persistência ─────────────────────────────────────────────────────────

  persistBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) return;
    this.persistBuckets();
  }

  persistBuckets() {
    const bucketsObj = {};
    for (const [name, bucket] of this.buckets.entries()) {
      const objectsObj = {};
      for (const [key, obj] of bucket.objects.entries()) {
        objectsObj[key] = {
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          contentType: obj.contentType,
          metadata: obj.metadata,
          lastModified: obj.lastModified,
        };
      }
      bucketsObj[name] = {
        creationDate: bucket.creationDate.toISOString(),
        region: bucket.region || "us-east-1",
        arn: bucket.arn || `arn:aws:s3:::${name}`,
        website: bucket.website || false,
        websiteConfiguration: bucket.websiteConfiguration || null,
        notificationConfiguration: bucket.notificationConfiguration || null,
        encryptionConfiguration: bucket.encryptionConfiguration || { sseType: "AES256" },
        tags: bucket.tags || {},
        versioning: bucket.versioning || "Suspended",
        blockPublicAccess: bucket.blockPublicAccess !== false,
        publicAccessBlock: bucket.publicAccessBlock || {
          BlockPublicAcls: bucket.blockPublicAccess !== false,
          IgnorePublicAcls: bucket.blockPublicAccess !== false,
          BlockPublicPolicy: bucket.blockPublicAccess !== false,
          RestrictPublicBuckets: bucket.blockPublicAccess !== false,
        },
        objectOwnership: bucket.objectOwnership || "BucketOwnerEnforced",
        objects: objectsObj,
        objectCount: bucket.objectCount,
        totalSize: bucket.totalSize,
      };
    }
    this.store.write("__buckets__", bucketsObj);
  }

  // Directory Buckets
  createDirectoryBucket(name, options = {}) {
    if (!name) return { error: { code: 'InvalidBucketName', message: 'Bucket name is required' }, status: 400 };
    if (name.length > 63 || !/^[a-z0-9][a-z0-9-]*--[a-z0-9]+-az\d--x-s3$/.test(name)) {
      return {
        error: {
          code: 'InvalidBucketName',
          message: 'Directory bucket names must be 3–63 characters long, contain only lowercase letters, numbers, and hyphens, and end with --<availability-zone-id>--x-s3',
        },
        status: 400,
      };
    }
    if (this._bucketNameExists(name)) {
      return { error: { code: 'BucketAlreadyExists', message: 'Bucket already exists' }, status: 409 };
    }

    const encryption = this._normalizeEncryption(options.encryptionConfiguration || options.encryption);
    if (encryption.error) return { error: encryption.error, status: 400 };

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const availabilityZone =
      options.availabilityZone ||
      options.AvailabilityZone ||
      (name.match(/--([a-z0-9]+-az\d)--x-s3$/) || [])[1] ||
      null;
    const region = options.region || this.region;
    const bucket = {
      name,
      type: 'directory',
      region,
      availabilityZone,
      status: 'Active',
      creationDate: new Date(),
      arn: `arn:aws:s3express:${region}:${this.accountId}:bucket/${name}`,
      encryptionConfiguration: encryption.value,
      tags: tags.value,
    };
    this.directoryBuckets.set(name, bucket);
    this._persistExtended('directory-buckets', '__directory_buckets__', this.directoryBuckets);
    return { bucket: this._directoryBucketToJson(bucket) };
  }

  listDirectoryBuckets() {
    return Array.from(this.directoryBuckets.values())
      .sort((a, b) => a.creationDate - b.creationDate)
      .map((bucket) => this._directoryBucketToJson(bucket));
  }

  getDirectoryBucket(name) {
    const bucket = this.directoryBuckets.get(name);
    if (!bucket) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    return { bucket: this._directoryBucketToJson(bucket) };
  }

  deleteDirectoryBucket(name) {
    if (!this.directoryBuckets.has(name)) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    this.directoryBuckets.delete(name);
    this._persistExtended('directory-buckets', '__directory_buckets__', this.directoryBuckets);
    return { success: true };
  }

  _directoryBucketToJson(bucket) {
    return {
      Name: bucket.name,
      ARN: bucket.arn,
      Region: bucket.region,
      AvailabilityZone: bucket.availabilityZone,
      Status: bucket.status,
      CreationDate: bucket.creationDate?.toISOString?.() || new Date().toISOString(),
      EncryptionConfiguration: bucket.encryptionConfiguration,
      Tags: bucket.tags || {},
    };
  }

  // Table Buckets
  createTableBucket(name, options = {}) {
    if (!name) return { error: { code: 'InvalidBucketName', message: 'Bucket name is required' }, status: 400 };
    if (name.length < 3 || name.length > 63 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
      return {
        error: {
          code: 'InvalidBucketName',
          message: 'Table bucket names must be 3–63 characters long and contain only lowercase letters, numbers, and hyphens',
        },
        status: 400,
      };
    }
    if (this._bucketNameExists(name)) {
      return { error: { code: 'BucketAlreadyExists', message: 'Bucket already exists' }, status: 409 };
    }

    const encryption = this._normalizeEncryption(options.encryptionConfiguration || options.encryption);
    if (encryption.error) return { error: encryption.error, status: 400 };

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const region = options.region || this.region;
    const bucket = {
      name,
      type: 'table',
      region,
      status: 'Active',
      creationDate: new Date(),
      arn: `arn:aws:s3tables:${region}:${this.accountId}:bucket/${name}`,
      encryptionConfiguration: encryption.value,
      tags: tags.value,
    };
    this.tableBuckets.set(name, bucket);
    this._persistExtended('table-buckets', '__table_buckets__', this.tableBuckets);
    return { bucket: this._tableBucketToJson(bucket) };
  }

  listTableBuckets() {
    return Array.from(this.tableBuckets.values())
      .sort((a, b) => a.creationDate - b.creationDate)
      .map((bucket) => this._tableBucketToJson(bucket));
  }

  getTableBucket(name) {
    const bucket = this.tableBuckets.get(name);
    if (!bucket) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    return { bucket: this._tableBucketToJson(bucket) };
  }

  deleteTableBucket(name) {
    if (!this.tableBuckets.has(name)) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    this.tableBuckets.delete(name);
    this._persistExtended('table-buckets', '__table_buckets__', this.tableBuckets);
    return { success: true };
  }

  _tableBucketToJson(bucket) {
    return {
      Name: bucket.name,
      ARN: bucket.arn,
      Region: bucket.region,
      Status: bucket.status,
      CreationDate: bucket.creationDate?.toISOString?.() || new Date().toISOString(),
      EncryptionConfiguration: bucket.encryptionConfiguration,
      Tags: bucket.tags || {},
    };
  }

  _bucketNameExists(name) {
    return (
      this.buckets.has(name) ||
      this.directoryBuckets.has(name) ||
      this.tableBuckets.has(name) ||
      this.vectorBuckets.has(name)
    );
  }

  // Vector Buckets
  createVectorBucket(name, options = {}) {
    if (!name) return { error: { code: 'InvalidBucketName', message: 'Vector bucket name is required' }, status: 400 };
    if (!/^[a-z0-9-]{3,63}$/.test(name)) {
      return { error: { code: 'InvalidBucketName', message: 'Vector bucket names must be 3–63 characters long and contain only lowercase letters, numbers, and hyphens' }, status: 400 };
    }
    if (this._bucketNameExists(name)) {
      return { error: { code: 'BucketAlreadyExists', message: 'Bucket already exists' }, status: 409 };
    }

    const encryption = this._normalizeEncryption(options.encryptionConfiguration || options.encryption);
    if (encryption.error) return { error: encryption.error, status: 400 };

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const region = options.region || this.region;
    const bucket = {
      name,
      type: 'vector',
      region,
      status: 'Active',
      creationDate: new Date(),
      arn: `arn:aws:s3vectors:${region}:${this.accountId}:bucket/${name}`,
      encryptionConfiguration: encryption.value,
      tags: tags.value,
    };
    this.vectorBuckets.set(name, bucket);
    this._persistExtended('vector-buckets', '__vector_buckets__', this.vectorBuckets);
    return { bucket: this._vectorBucketToJson(bucket) };
  }

  listVectorBuckets() {
    return Array.from(this.vectorBuckets.values())
      .sort((a, b) => a.creationDate - b.creationDate)
      .map((bucket) => this._vectorBucketToJson(bucket));
  }

  getVectorBucket(name) {
    const bucket = this.vectorBuckets.get(name);
    if (!bucket) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    return { bucket: this._vectorBucketToJson(bucket) };
  }

  deleteVectorBucket(name) {
    if (!this.vectorBuckets.has(name)) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    const indexes = this._vectorIndexesOfBucket(name);
    if (indexes.length > 0) {
      return { error: { code: 'ConflictException', message: 'The specified vector bucket is not empty' }, status: 409 };
    }
    this.vectorBuckets.delete(name);
    this._persistExtended('vector-buckets', '__vector_buckets__', this.vectorBuckets);
    return { success: true };
  }

  _vectorBucketToJson(bucket) {
    return {
      Name: bucket.name,
      ARN: bucket.arn,
      Region: bucket.region,
      Status: bucket.status,
      CreationDate: bucket.creationDate?.toISOString?.() || new Date().toISOString(),
      EncryptionConfiguration: bucket.encryptionConfiguration,
      Tags: bucket.tags || {},
    };
  }

  _normalizeEncryption(input) {
    const sseType = input?.sseType || input?.SSEType || 'AES256';
    if (sseType !== 'AES256' && sseType !== 'aws:kms') {
      return { error: { code: 'ValidationException', message: 'Encryption type must be AES256 or aws:kms' } };
    }
    const kmsKeyArn = input?.kmsKeyArn || input?.KMSKeyArn || null;
    if (sseType === 'aws:kms') {
      if (!kmsKeyArn) return { error: { code: 'ValidationException', message: 'A KMS key ARN is required when using aws:kms encryption' } };
      if (!String(kmsKeyArn).startsWith('arn:aws:kms:')) {
        return { error: { code: 'ValidationException', message: 'KMS key ARN must start with arn:aws:kms:' } };
      }
    }
    const bucketKeyEnabled =
      input?.bucketKeyEnabled !== undefined ? !!input.bucketKeyEnabled : undefined;
    return {
      value: {
        sseType,
        ...(kmsKeyArn ? { kmsKeyArn } : {}),
        ...(bucketKeyEnabled !== undefined ? { bucketKeyEnabled } : {}),
      },
    };
  }

  _normalizeTags(input) {
    if (!input) return { value: {} };
    let entries;
    if (Array.isArray(input)) {
      entries = input.map((t) => [t?.Key ?? t?.key, t?.Value ?? t?.value]);
    } else if (typeof input === 'object') {
      entries = Object.entries(input);
    } else {
      return { error: { code: 'ValidationException', message: 'Tags must be an object or an array' } };
    }
    if (entries.length > 50) return { error: { code: 'ValidationException', message: 'A maximum of 50 tags is allowed' } };
    const tags = {};
    for (const [key, value] of entries) {
      if (!key || typeof key !== 'string' || key.length > 128) {
        return { error: { code: 'ValidationException', message: 'Tag keys must be between 1 and 128 characters' } };
      }
      tags[key] = value == null ? '' : String(value);
    }
    return { value: tags };
  }

  _normalizePublicAccessBlock(input, blockAll) {
    const defaultValue = blockAll === undefined ? true : !!blockAll;
    const value = {
      BlockPublicAcls: defaultValue,
      IgnorePublicAcls: defaultValue,
      BlockPublicPolicy: defaultValue,
      RestrictPublicBuckets: defaultValue,
    };
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const keys = {
        BlockPublicAcls: ['BlockPublicAcls', 'blockPublicAcls'],
        IgnorePublicAcls: ['IgnorePublicAcls', 'ignorePublicAcls'],
        BlockPublicPolicy: ['BlockPublicPolicy', 'blockPublicPolicy'],
        RestrictPublicBuckets: ['RestrictPublicBuckets', 'restrictPublicBuckets'],
      };
      for (const [target, aliases] of Object.entries(keys)) {
        const provided = aliases.reduce((found, alias) => (found !== undefined ? found : input[alias]), undefined);
        if (provided !== undefined) value[target] = !!provided;
      }
    }
    return { value };
  }

  // Vector Indexes
  createVectorIndex(bucketName, name, options = {}) {
    const bucket = this.vectorBuckets.get(bucketName);
    if (!bucket) return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    if (!name) return { error: { code: 'ValidationException', message: 'Vector index name is required' }, status: 400 };
    if (!/^[a-z0-9.-]{3,63}$/.test(name)) {
      return { error: { code: 'ValidationException', message: 'Vector index names must be 3–63 characters long and contain only lowercase letters, numbers, hyphens, and dots' }, status: 400 };
    }
    const key = `${bucketName}/${name}`;
    if (this.vectorIndexes.has(key)) return { error: { code: 'ConflictException', message: 'Vector index already exists' }, status: 409 };

    const dimension = Number(options.dimension ?? options.Dimension);
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 4096) {
      return { error: { code: 'ValidationException', message: 'Dimension must be an integer between 1 and 4096' }, status: 400 };
    }

    const distanceMetric = String(options.distanceMetric ?? options.DistanceMetric ?? 'cosine').toLowerCase();
    if (!['cosine', 'euclidean'].includes(distanceMetric)) {
      return { error: { code: 'ValidationException', message: 'Distance metric must be cosine or euclidean' }, status: 400 };
    }

    const metadataKeys = options.nonFilterableMetadataKeys ?? options.NonFilterableMetadataKeys ?? [];
    if (!Array.isArray(metadataKeys)) {
      return { error: { code: 'ValidationException', message: 'Non-filterable metadata keys must be an array' }, status: 400 };
    }
    if (metadataKeys.length > 10) {
      return { error: { code: 'ValidationException', message: 'A maximum of 10 non-filterable metadata keys is allowed' }, status: 400 };
    }
    const keys = metadataKeys.map((k) => String(k).trim());
    if (keys.some((k) => k.length < 1 || k.length > 63)) {
      return { error: { code: 'ValidationException', message: 'Metadata keys must be between 1 and 63 characters' }, status: 400 };
    }
    if (new Set(keys).size !== keys.length) {
      return { error: { code: 'ValidationException', message: 'Metadata keys must be unique' }, status: 400 };
    }

    const override = options.encryptionConfiguration || options.encryption;
    const encryption = override
      ? this._normalizeEncryption(override)
      : { value: bucket.encryptionConfiguration };
    if (encryption.error) return { error: encryption.error, status: 400 };

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const index = {
      bucketName,
      name,
      dimension,
      distanceMetric,
      dataType: options.dataType || options.DataType || 'float32',
      nonFilterableMetadataKeys: keys,
      encryptionConfiguration: encryption.value,
      encryptionSource: override ? 'override' : 'bucket',
      tags: tags.value,
      status: 'Active',
      creationDate: new Date(),
      arn: `${bucket.arn}/index/${name}`,
    };
    this.vectorIndexes.set(key, index);
    this._persistExtended('vector-indexes', '__vector_indexes__', this.vectorIndexes);
    return { index: this._vectorIndexToJson(index) };
  }

  listVectorIndexes(bucketName) {
    if (!this.vectorBuckets.has(bucketName)) {
      return { error: { code: 'NoSuchBucket', message: 'Bucket does not exist' }, status: 404 };
    }
    return {
      indexes: this._vectorIndexesOfBucket(bucketName)
        .sort((a, b) => a.creationDate - b.creationDate)
        .map((index) => this._vectorIndexToJson(index)),
    };
  }

  getVectorIndex(bucketName, name) {
    const index = this.vectorIndexes.get(`${bucketName}/${name}`);
    if (!index) return { error: { code: 'NoSuchIndex', message: 'Vector index does not exist' }, status: 404 };
    return { index: this._vectorIndexToJson(index) };
  }

  deleteVectorIndex(bucketName, name) {
    const key = `${bucketName}/${name}`;
    if (!this.vectorIndexes.has(key)) return { error: { code: 'NoSuchIndex', message: 'Vector index does not exist' }, status: 404 };
    this.vectorIndexes.delete(key);
    this._persistExtended('vector-indexes', '__vector_indexes__', this.vectorIndexes);
    return { success: true };
  }

  _vectorIndexesOfBucket(bucketName) {
    return Array.from(this.vectorIndexes.values()).filter((index) => index.bucketName === bucketName);
  }

  _vectorIndexToJson(index) {
    return {
      Name: index.name,
      ARN: index.arn,
      VectorBucketName: index.bucketName,
      Dimension: index.dimension,
      DistanceMetric: index.distanceMetric,
      DataType: index.dataType,
      NonFilterableMetadataKeys: index.nonFilterableMetadataKeys || [],
      EncryptionConfiguration: index.encryptionConfiguration,
      EncryptionSource: index.encryptionSource,
      Tags: index.tags || {},
      Status: index.status,
      CreationDate: index.creationDate?.toISOString?.() || new Date().toISOString(),
    };
  }

  // Access Points
  createAccessPoint(name, options = {}) {
    if (!name) return { error: { code: 'InvalidAccessPointName', message: 'Access point name is required' }, status: 400 };
    if (this.accessPoints.has(name)) return { error: { code: 'AccessPointAlreadyExists', message: 'Access point already exists' }, status: 409 };

    const bucketName = options.bucket || options.Bucket;
    if (bucketName) {
      const bucketArn = String(bucketName).replace(/^arn:aws[a-z-]*:s3:::/, '').replace(/^s3:\/\//, '').split('/')[0];
      const bucket = this.buckets.get(bucketArn);
      if (!bucket) {
        return { error: { code: 'ResourceNotFoundException', message: `Bucket ${bucketArn} does not exist` }, status: 404 };
      }
    }

    const ap = { name, bucket: options.bucket, networkOrigin: options.networkOrigin || 'Public', vpcId: options.vpcId || null, status: 'Ready', alias: `${name}-${this.accountId}.s3-accesspoint.${this.region}.amazonaws.com`, policy: null, creationDate: new Date(), arn: `arn:aws:s3:${this.region}:${this.accountId}:accesspoint/${name}` };
    this.accessPoints.set(name, ap);
    this._persistExtended('access-points', '__access_points__', this.accessPoints);
    return { accessPoint: ap };
  }
  listAccessPoints() {
    return Array.from(this.accessPoints.values()).map(ap => ({ Name: ap.name, Bucket: ap.bucket, Status: ap.status, NetworkOrigin: ap.networkOrigin, Alias: ap.alias, CreationDate: ap.creationDate?.toISOString?.(), ARN: ap.arn }));
  }
  getAccessPoint(name) {
    const ap = this.accessPoints.get(name);
    if (!ap) return { error: { code: 'NoSuchAccessPoint', message: 'Access point does not exist' }, status: 404 };
    return { accessPoint: ap };
  }
  deleteAccessPoint(name) {
    if (!this.accessPoints.has(name)) return { error: { code: 'NoSuchAccessPoint', message: 'Access point does not exist' }, status: 404 };
    this.accessPoints.delete(name);
    this._persistExtended('access-points', '__access_points__', this.accessPoints);
    return { success: true };
  }
  putAccessPointPolicy(name, policy) {
    const ap = this.accessPoints.get(name);
    if (!ap) return { error: { code: 'NoSuchAccessPoint', message: 'Access point does not exist' }, status: 404 };
    try {
      ap.policy = typeof policy === 'string' ? JSON.parse(policy) : policy;
      this._persistExtended('access-points', '__access_points__', this.accessPoints);
      return { success: true };
    } catch (e) {
      return { error: { code: 'InvalidPolicyDocument', message: e.message }, status: 400 };
    }
  }
  getAccessPointPolicy(name) {
    const ap = this.accessPoints.get(name);
    if (!ap) return { error: { code: 'NoSuchAccessPoint', message: 'Access point does not exist' }, status: 404 };
    if (!ap.policy) return { error: { code: 'NoSuchAccessPointPolicy', message: 'The access point policy does not exist' }, status: 404 };
    return { policy: ap.policy };
  }

  // File systems
  createFileSystem(options = {}) {
    const bucketInput = options.bucket || options.Bucket;
    const bucketName = bucketInput
      ? String(bucketInput).replace(/^arn:aws[a-z-]*:s3:::/, '').replace(/^s3:\/\//, '').split('/')[0]
      : null;

    if (!bucketName) {
      return { error: { code: 'ValidationException', message: 'An S3 bucket is required' }, status: 400 };
    }

    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return {
        error: { code: 'ResourceNotFoundException', message: `Bucket ${bucketName} does not exist` },
        status: 404,
      };
    }

    const prefix = options.prefix ?? options.Prefix ?? '';
    if (prefix && !String(prefix).endsWith('/')) {
      return { error: { code: 'ValidationException', message: 'Prefix must end with /' }, status: 400 };
    }

    const tags = this._normalizeTags(options.tags || options.Tags);
    if (tags.error) return { error: tags.error, status: 400 };

    const name = (options.name || options.Name || tags.value.Name || bucketName).toString();
    const region = options.region || options.Region || bucket.region || 'us-east-1';

    const duplicate = Array.from(this.fileSystems.values()).find(
      (item) => item.bucketName === bucketName && (item.prefix || '') === (prefix || '')
    );
    if (duplicate) {
      return {
        error: {
          code: 'ConflictException',
          message: `A file system already exists for s3://${bucketName}/${prefix || ''}`,
        },
        status: 409,
      };
    }

    const id = options.id || `fs-${crypto.randomUUID().replace(/-/g, '').slice(0, 17)}`;
    const vpcId = options.vpcId || options.VpcId || null;
    const availabilityZones = ['a', 'b', 'c'];
    const mountTargets = vpcId
      ? availabilityZones.map((az) => ({
          MountTargetId: `fsmt-${crypto.randomUUID().replace(/-/g, '').slice(0, 17)}`,
          VpcId: vpcId,
          AvailabilityZoneId: `${region}${az}`,
          State: 'available',
        }))
      : [];

    const fs = {
      id,
      arn: `arn:aws:s3files:${region}:000000000000:file-system/${id}`,
      name,
      bucket: `arn:aws:s3:::${bucketName}`,
      bucketName,
      prefix: prefix || '',
      roleArn:
        options.roleArn ||
        options.RoleArn ||
        'arn:aws:iam::000000000000:role/s3files-sync-role',
      kmsKeyId: options.kmsKeyId || options.KmsKeyId || null,
      vpcId,
      status: 'Available',
      region,
      tags: tags.value,
      mountTargets,
      creationDate: new Date(),
    };

    this.fileSystems.set(id, fs);
    this._persistExtended('file-systems', '__file_systems__', this.fileSystems);
    return { fileSystem: this._fileSystemToJson(fs) };
  }

  getFileSystem(id) {
    const fs = this.fileSystems.get(id);
    if (!fs) {
      return {
        error: { code: 'ResourceNotFoundException', message: 'File system does not exist' },
        status: 404,
      };
    }
    return { fileSystem: this._fileSystemToJson(fs) };
  }

  listFileSystems() {
    return Array.from(this.fileSystems.values()).map((fs) => this._fileSystemToJson(fs));
  }

  _fileSystemToJson(fs) {
    const id = fs.id || fs.Id;
    const bucketName =
      fs.bucketName || (fs.bucket ? String(fs.bucket).replace(/^arn:aws[a-z-]*:s3:::/, '') : null);
    return {
      Id: id,
      ARN: fs.arn || `arn:aws:s3files:${fs.region || 'us-east-1'}:000000000000:file-system/${id}`,
      Name: fs.name || fs.Name || bucketName,
      Bucket: fs.bucket || (bucketName ? `arn:aws:s3:::${bucketName}` : null),
      BucketName: bucketName,
      Prefix: fs.prefix || '',
      RoleArn: fs.roleArn || null,
      KmsKeyId: fs.kmsKeyId || null,
      VpcId: fs.vpcId || null,
      Status: fs.status || 'Available',
      Region: fs.region || 'us-east-1',
      Tags: fs.tags || {},
      MountTargets: fs.mountTargets || [],
      CreationDate: fs.creationDate?.toISOString?.() || fs.creationDate || null,
    };
  }

  deleteFileSystem(id) {
    if (!this.fileSystems.has(id)) return { error: { code: 'NoSuchFileSystem', message: 'File system does not exist' }, status: 404 };
    this.fileSystems.delete(id);
    this._persistExtended('file-systems', '__file_systems__', this.fileSystems);
    return { success: true };
  }

  // Access Grants
  createAccessGrant(options = {}) {
    const grantee = options.grantee || options.Grantee;
    if (!grantee) {
      return { error: { code: 'ValidationException', message: 'Grantee is required' }, status: 400 };
    }
    const permission = (options.permission || options.Permission || 'READ').toString().toUpperCase();
    const validPermissions = ['READ', 'WRITE', 'READWRITE'];
    if (!validPermissions.includes(permission)) {
      return { error: { code: 'ValidationException', message: 'Permission must be READ, WRITE or READWRITE' }, status: 400 };
    }
    const location = options.location || options.Location || '';
    const id = options.id || `ag-${crypto.randomUUID().replace(/-/g,'').slice(0,17)}`;
    const grant = { id, grantee, permission, location, status: 'Active', creationDate: new Date() };
    this.accessGrants.set(id, grant);
    this._persistExtended('access-grants', '__access_grants__', this.accessGrants);
    return { accessGrant: this._accessGrantToJson(grant) };
  }

  getAccessGrant(id) {
    const grant = this.accessGrants.get(id);
    if (!grant) {
      return { error: { code: 'NoSuchAccessGrant', message: 'Access grant does not exist' }, status: 404 };
    }
    return { accessGrant: this._accessGrantToJson(grant) };
  }

  listAccessGrants() {
    return Array.from(this.accessGrants.values()).map((grant) => this._accessGrantToJson(grant));
  }

  deleteAccessGrant(id) {
    if (!this.accessGrants.has(id)) return { error: { code: 'NoSuchAccessGrant', message: 'Access grant does not exist' }, status: 404 };
    this.accessGrants.delete(id);
    this._persistExtended('access-grants', '__access_grants__', this.accessGrants);
    return { success: true };
  }

  _accessGrantToJson(grant) {
    return {
      Id: grant.id,
      Grantee: grant.grantee,
      Permission: grant.permission,
      Location: grant.location,
      Status: grant.status,
      CreationDate: grant.creationDate?.toISOString?.() || grant.creationDate || null,
    };
  }

  // Storage Lens
  createStorageLensConfiguration(id, options = {}) {
    const config = { id, status: options.status || 'Enabled', include: options.include || {}, exclude: options.exclude || {}, creationDate: new Date() };
    this.storageLensConfigs.set(id, config);
    this._persistExtended('storage-lens', '__storage_lens__', this.storageLensConfigs);
    return { storageLensConfiguration: config };
  }
  listStorageLensConfigurations() {
    return Array.from(this.storageLensConfigs.values());
  }
  getStorageLensConfiguration(id) {
    const c = this.storageLensConfigs.get(id);
    if (!c) return { error: { code: 'NoSuchConfiguration', message: 'Configuration does not exist' }, status: 404 };
    return { storageLensConfiguration: c };
  }
  deleteStorageLensConfiguration(id) {
    if (!this.storageLensConfigs.has(id)) return { error: { code: 'NoSuchConfiguration', message: 'Configuration does not exist' }, status: 404 };
    this.storageLensConfigs.delete(id);
    this._persistExtended('storage-lens', '__storage_lens__', this.storageLensConfigs);
    return { success: true };
  }

  // Batch Operations
  createBatchJob(options = {}) {
    const jobId = options.jobId || `job-${crypto.randomUUID()}`;
    const job = { jobId, operation: options.operation || 'LambdaInvoke', status: 'Active', priority: options.priority || 10, manifest: options.manifest, report: options.report, creationDate: new Date(), description: options.description || '' };
    this.batchJobs.set(jobId, job);
    this._persistExtended('batch-jobs', '__batch_jobs__', this.batchJobs);
    return { job };
  }
  listBatchJobs() {
    return Array.from(this.batchJobs.values()).map(j => ({ JobId: j.jobId, Operation: j.operation, Status: j.status, Priority: j.priority, CreationTime: j.creationDate?.toISOString?.(), Description: j.description }));
  }
  getBatchJob(jobId) {
    const j = this.batchJobs.get(jobId);
    if (!j) return { error: { code: 'NoSuchJob', message: 'Job does not exist' }, status: 404 };
    return { job: j };
  }
  cancelBatchJob(jobId) {
    const j = this.batchJobs.get(jobId);
    if (!j) return { error: { code: 'NoSuchJob', message: 'Job does not exist' }, status: 404 };
    j.status = 'Cancelled';
    this._persistExtended('batch-jobs', '__batch_jobs__', this.batchJobs);
    return { success: true };
  }

  _persistExtended(name, key, map) {
    const obj = {};
    for (const [k, v] of map.entries()) {
      obj[k] = JSON.parse(JSON.stringify(v, (key2, val) => {
        if (val instanceof Date) return val.toISOString();
        return val;
      }));
    }
    try { this.store.write(key, obj); } catch (e) { logger.debug(`S3: failed to persist ${name}: ${e.message}`); }
  }

  async reset() {
    for (const [name, bucket] of this.buckets) {
      for (const key of bucket.objects.keys()) {
        this._deleteObjectContent(name, key);
      }
      bucket.objects.clear();
      bucket.objectCount = 0;
      bucket.totalSize = 0;
      this.store.write(name, {});
    }
    this.persistBuckets();
    this.directoryBuckets.clear(); this._persistExtended('directory-buckets', '__directory_buckets__', this.directoryBuckets);
    this.tableBuckets.clear(); this._persistExtended('table-buckets', '__table_buckets__', this.tableBuckets);
    this.vectorBuckets.clear(); this._persistExtended('vector-buckets', '__vector_buckets__', this.vectorBuckets);
    this.vectorIndexes.clear(); this._persistExtended('vector-indexes', '__vector_indexes__', this.vectorIndexes);
    this.accessPoints.clear(); this._persistExtended('access-points', '__access_points__', this.accessPoints);
    this.fileSystems.clear(); this._persistExtended('file-systems', '__file_systems__', this.fileSystems);
    this.accessGrants.clear(); this._persistExtended('access-grants', '__access_grants__', this.accessGrants);
    this.storageLensConfigs.clear(); this._persistExtended('storage-lens', '__storage_lens__', this.storageLensConfigs);
    this.batchJobs.clear(); this._persistExtended('batch-jobs', '__batch_jobs__', this.batchJobs);
    logger.debug("S3: Todos os dados resetados");
  }

  // ─── Utilitários ──────────────────────────────────────────────────────────

  isValidBucketName(bucketName) {
    // Regras oficiais do S3: 3-63 chars, apenas minúsculas, números, pontos e hífens,
    // começando e terminando com letra ou número, sem ".." e sem formato de IP.
    if (typeof bucketName !== "string") return false;
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) return false;
    if (bucketName.includes("..")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(bucketName)) return false;
    return true;
  }


  extractMetadata(headers) {
    const metadata = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith("x-amz-meta-")) {
        metadata[key.replace("x-amz-meta-", "")] = value;
      }
    }
    return metadata;
  }

  getStats() {
    return {
      bucketsCount: this.buckets.size,
      totalObjects: this.getTotalObjectsCount(),
      buckets: Array.from(this.buckets.keys()),
    };
  }

  // ─── XML Responses ────────────────────────────────────────────────────────

  generateListBucketsResponse(buckets) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Owner>
    <ID>local-simulator</ID>
    <DisplayName>local-simulator</DisplayName>
  </Owner>
  <Buckets>
    ${buckets.map((b) => `<Bucket><Name>${b.Name}</Name><CreationDate>${b.CreationDate}</CreationDate></Bucket>`).join("")}
  </Buckets>
</ListAllMyBucketsResult>`;
  }

  generateListObjectsResponse(data) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>${data.name}</Name>
  <Prefix>${data.prefix}</Prefix>
  <MaxKeys>${data.maxKeys}</MaxKeys>
  <IsTruncated>${data.isTruncated}</IsTruncated>
  ${data.contents.map((obj) => `<Contents><Key>${obj.Key}</Key><LastModified>${obj.LastModified}</LastModified><ETag>${obj.ETag}</ETag><Size>${obj.Size}</Size><StorageClass>${obj.StorageClass}</StorageClass></Contents>`).join("")}
  ${data.commonPrefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("")}
</ListBucketResult>`;
  }

  generateListObjectsV2Response(data) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>${data.name}</Name>
  <Prefix>${data.prefix}</Prefix>
  <MaxKeys>${data.maxKeys}</MaxKeys>
  <IsTruncated>${data.isTruncated}</IsTruncated>
  <KeyCount>${data.contents.length}</KeyCount>
  ${data.contents.map((obj) => `<Contents><Key>${obj.Key}</Key><LastModified>${obj.LastModified}</LastModified><ETag>${obj.ETag}</ETag><Size>${obj.Size}</Size><StorageClass>${obj.StorageClass}</StorageClass></Contents>`).join("")}
  ${data.commonPrefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("")}
</ListBucketResult>`;
  }

  generateErrorResponse(code, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
  <RequestId>${crypto.randomUUID()}</RequestId>
  <HostId>local-simulator</HostId>
</Error>`;
  }

  // ─── Presigned URLs ──────────────────────────────────────────────────────

  /**
   * Generate a presigned GET URL for downloading an object
   * @param {string} bucketName - Bucket name
   * @param {string} key - Object key
   * @param {object} options - Options { expiresIn, credentials }
   * @returns {object} { url, presignedUrl, expiration }
   */
  generatePresignedGetUrl(bucketName, key, options = {}) {
    const bucket = this.getBucket(bucketName);
    if (!bucket) {
      return { error: { code: 'NoSuchBucket', message: `The specified bucket does not exist: ${bucketName}` }, status: 404 };
    }

    try {
      const result = this.presignedUrlGenerator.generateGetUrl(bucketName, key, options);
      return { presignedUrl: result };
    } catch (err) {
      logger.error('S3: Error generating presigned GET URL:', err);
      return { error: { code: 'InternalError', message: err.message }, status: 500 };
    }
  }

  /**
   * Generate a presigned PUT URL for uploading an object
   * @param {string} bucketName - Bucket name
   * @param {string} key - Object key
   * @param {object} options - Options { expiresIn, credentials, contentType }
   * @returns {object} { presignedUrl, expiration }
   */
  generatePresignedPutUrl(bucketName, key, options = {}) {
    const bucket = this.getBucket(bucketName);
    if (!bucket) {
      return { error: { code: 'NoSuchBucket', message: `The specified bucket does not exist: ${bucketName}` }, status: 404 };
    }

    try {
      const result = this.presignedUrlGenerator.generatePutUrl(bucketName, key, options);
      return { presignedUrl: result };
    } catch (err) {
      logger.error('S3: Error generating presigned PUT URL:', err);
      return { error: { code: 'InternalError', message: err.message }, status: 500 };
    }
  }

  /**
   * Generate a presigned DELETE URL for deleting an object
   * @param {string} bucketName - Bucket name
   * @param {string} key - Object key
   * @param {object} options - Options { expiresIn, credentials }
   * @returns {object} { presignedUrl, expiration }
   */
  generatePresignedDeleteUrl(bucketName, key, options = {}) {
    const bucket = this.getBucket(bucketName);
    if (!bucket) {
      return { error: { code: 'NoSuchBucket', message: `The specified bucket does not exist: ${bucketName}` }, status: 404 };
    }

    try {
      const result = this.presignedUrlGenerator.generateDeleteUrl(bucketName, key, options);
      return { presignedUrl: result };
    } catch (err) {
      logger.error('S3: Error generating presigned DELETE URL:', err);
      return { error: { code: 'InternalError', message: err.message }, status: 500 };
    }
  }

  /**
   * Generate a presigned HEAD URL for checking object metadata
   * @param {string} bucketName - Bucket name
   * @param {string} key - Object key
   * @param {object} options - Options { expiresIn, credentials }
   * @returns {object} { presignedUrl, expiration }
   */
  generatePresignedHeadUrl(bucketName, key, options = {}) {
    const bucket = this.getBucket(bucketName);
    if (!bucket) {
      return { error: { code: 'NoSuchBucket', message: `The specified bucket does not exist: ${bucketName}` }, status: 404 };
    }

    try {
      const result = this.presignedUrlGenerator.generateHeadUrl(bucketName, key, options);
      return { presignedUrl: result };
    } catch (err) {
      logger.error('S3: Error generating presigned HEAD URL:', err);
      return { error: { code: 'InternalError', message: err.message }, status: 500 };
    }
  }

  /**
   * Generate a presigned POST policy for form uploads
   * @param {string} bucketName - Bucket name
   * @param {string} key - Object key
   * @param {object} options - Options { expiresIn, conditions, contentType }
   * @returns {object} { policy, signature, amzAlgorithm, amzDate, amzCredential }
   */
  generatePresignedPostPolicy(bucketName, key, options = {}) {
    const bucket = this.getBucket(bucketName);
    if (!bucket) {
      return { error: { code: 'NoSuchBucket', message: `The specified bucket does not exist: ${bucketName}` }, status: 404 };
    }

    try {
      const result = this.presignedUrlGenerator.generatePostPolicy(bucketName, key, options);
      return result;
    } catch (err) {
      logger.error('S3: Error generating presigned POST policy:', err);
      return { error: { code: 'InternalError', message: err.message }, status: 500 };
    }
  }

  /**
   * Validate a presigned URL
   * @param {string} url - Presigned URL to validate
   * @param {string} method - HTTP method (GET, PUT, DELETE, HEAD)
   * @param {object} credentials - Optional credentials for validation
   * @returns {object} { valid: boolean, message: string, expiresAt: Date }
   */
  validatePresignedUrl(url, method = 'GET', credentials = null) {
    try {
      const result = this.presignedUrlGenerator.validatePresignedUrl(url, method, credentials);
      return result;
    } catch (err) {
      logger.error('S3: Error validating presigned URL:', err);
      return { valid: false, message: err.message };
    }
  }
}

module.exports = S3Simulator;
