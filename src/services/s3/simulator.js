/**
 * S3 Simulator Core
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");

class S3Simulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, "s3");
    this.store = new LocalStore(this.dataDir);
    this.buckets = new Map();
    this.audit = new CloudTrailAudit("s3.amazonaws.com");
  }

  async initialize() {
    logger.debug("Inicializando S3 Simulator...");
    this.loadBuckets();
    logger.debug(`✅ S3 Simulator inicializado com ${this.buckets.size} buckets`);
  }

  loadBuckets() {

    /*this.read()
    if (this.config.s3?.buckets) {
      for (const bucketName of this.config.s3.buckets) {
        this.createBucket(bucketName);
      }
    }*/

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
            creationDate: new Date(data.creationDate),
            objects,
            objectCount: data.objectCount || 0,
            totalSize: data.totalSize || 0,
          });
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

  createBucket(bucketName) {
    if (!this.isValidBucketName(bucketName)) {
      return { error: { code: "InvalidBucketName", message: "Bucket name is invalid" }, status: 400 };
    }

    if (this.buckets.has(bucketName)) {
      return { error: { code: "BucketAlreadyExists", message: "Bucket already exists" }, status: 409 };
    }

    const bucket = {
      name: bucketName,
      creationDate: new Date(),
      objects: new Map(),
      objectCount: 0,
      totalSize: 0,
    };

    this.buckets.set(bucketName, bucket);
    this.persistBuckets();
    logger.debug(`✅ Bucket S3 criado: ${bucketName}`);
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

  listBuckets() {
    return Array.from(this.buckets.values()).map((bucket) => ({
      Name: bucket.name,
      CreationDate: bucket.creationDate.toISOString(),
    }));
  }

  getBucketsInfo() {
    return Array.from(this.buckets.values()).map((bucket) => ({
      name: bucket.name,
      creationDate: bucket.creationDate,
      objectCount: bucket.objectCount,
      totalSize: bucket.totalSize,
    }));
  }

  getBucketInfo(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket not found" } };
    }
    return {
      name: bucket.name,
      creationDate: bucket.creationDate,
      objectCount: bucket.objectCount,
      totalSize: bucket.totalSize,
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
        objects: objectsObj,
        objectCount: bucket.objectCount,
        totalSize: bucket.totalSize,
      };
    }
    this.store.write("__buckets__", bucketsObj);
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
    logger.debug("S3: Todos os dados resetados");
  }

  // ─── Utilitários ──────────────────────────────────────────────────────────

  isValidBucketName(bucketName) {
    const regex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
    return regex.test(bucketName) && !bucketName.includes("..") && !bucketName.includes(".-") && !bucketName.includes("-.");
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
}

module.exports = S3Simulator;
