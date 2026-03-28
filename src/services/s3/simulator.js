/**
 * S3 Simulator Core
 */

const crypto = require("crypto");
const LocalStore = require("../../utils/local-store");
const logger = require("../../utils/logger");
const path = require("path");

class S3Simulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, "s3");
    this.store = new LocalStore(this.dataDir);
    this.buckets = new Map();
  }

  async initialize() {
    logger.debug("Inicializando S3 Simulator...");
    this.loadBuckets();
    logger.debug(`✅ S3 Simulator inicializado com ${this.buckets.size} buckets`);
  }

  loadBuckets() {
    // Carrega buckets da configuração
    if (this.config.s3?.buckets) {
      for (const bucketName of this.config.s3.buckets) {
        this.createBucket(bucketName);
      }
    }

    // Carrega buckets existentes do disco
    const savedBuckets = this.store.read("__buckets__");
    if (savedBuckets) {
      for (const [name, data] of Object.entries(savedBuckets)) {
        if (!this.buckets.has(name)) {
          this.buckets.set(name, {
            name,
            creationDate: new Date(data.creationDate),
            objects: new Map(Object.entries(data.objects || {})),
            objectCount: data.objectCount || 0,
            totalSize: data.totalSize || 0,
          });
        }
      }
    }
  }

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

    return { success: true };
  }

  putObject(bucketName, key, content, headers) {
    const bucket = this.buckets.get(bucketName);

    if (!bucket) {
      return { error: { code: "NoSuchBucket", message: "Bucket does not exist" }, status: 404 };
    }

    // Normaliza o conteúdo
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

    const object = {
      key,
      size: body.length,
      etag,
      contentType,
      metadata,
      lastModified: new Date(),
      content: body,
    };

    // Atualiza ou adiciona objeto
    const oldObject = bucket.objects.get(key);
    if (oldObject) {
      bucket.totalSize -= oldObject.size;
    } else {
      bucket.objectCount++;
    }

    bucket.objects.set(key, object);
    bucket.totalSize += body.length;

    this.persistBucket(bucketName);

    logger.verboso(`📤 Upload S3: ${bucketName}/${key} (${body.length} bytes)`);

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

    let content = object.content;
    let start = 0;
    let end = content.length - 1;

    // Suporte a Range headers
    if (headers.range) {
      const range = headers.range.match(/bytes=(\d+)-(\d+)?/);
      if (range) {
        start = parseInt(range[1], 10);
        end = range[2] ? parseInt(range[2], 10) : content.length - 1;
        content = content.slice(start, end + 1);
      }
    }

    return {
      content,
      etag: object.etag,
      lastModified: object.lastModified.toUTCString(),
      contentType: object.contentType,
      size: content.length,
      metadata: object.metadata,
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
      this.persistBucket(bucketName);
      logger.verboso(`🗑️ Delete S3: ${bucketName}/${key}`);
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
          const prefixPath = prefix + afterPrefix.substring(0, delimiterIndex + 1);
          commonPrefixes.add(prefixPath);
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

  clearBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (bucket) {
      bucket.objects.clear();
      bucket.objectCount = 0;
      bucket.totalSize = 0;
      this.persistBucket(bucketName);
    }
  }

  getBucketsCount() {
    return this.buckets.size;
  }

  isValidBucketName(bucketName) {
    const regex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
    return regex.test(bucketName) && !bucketName.includes("..") && !bucketName.includes(".-") && !bucketName.includes("-.");
  }

  extractMetadata(headers) {
    const metadata = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith("x-amz-meta-")) {
        const metaKey = key.replace("x-amz-meta-", "");
        metadata[metaKey] = value;
      }
    }
    return metadata;
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
          content: obj.content,
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

  isValidBucketName(bucketName) {
    const regex = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
    return regex.test(bucketName) && !bucketName.includes("..") && !bucketName.includes(".-") && !bucketName.includes("-.");
  }

  async reset() {
    for (const [name] of this.buckets) {
      const bucket = this.buckets.get(name);
      if (bucket) {
        bucket.objects.clear();
        bucket.objectCount = 0;
        bucket.totalSize = 0;
        this.store.write(name, {});
      }
    }
    this.persistBuckets();
    logger.debug("S3: Todos os dados resetados");
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

  getBucket(bucketName) {
    return this.buckets.get(bucketName);
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

    const object = {
      key,
      size: body.length,
      etag,
      contentType,
      metadata,
      lastModified: new Date(),
      content: body,
    };

    const oldObject = bucket.objects.get(key);
    if (oldObject) {
      bucket.totalSize -= oldObject.size;
    } else {
      bucket.objectCount++;
    }

    bucket.objects.set(key, object);
    bucket.totalSize += body.length;

    this.persistBucket(bucketName);

    logger.verboso(`📤 Upload S3: ${bucketName}/${key} (${body.length} bytes)`);

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

    let content = object.content;
    let start = 0;
    let end = content.length - 1;

    if (headers.range) {
      const range = headers.range.match(/bytes=(\d+)-(\d+)?/);
      if (range) {
        start = parseInt(range[1], 10);
        end = range[2] ? parseInt(range[2], 10) : content.length - 1;
        content = content.slice(start, end + 1);
      }
    }

    return {
      content,
      etag: object.etag,
      lastModified: object.lastModified.toUTCString(),
      contentType: object.contentType,
      size: content.length,
      metadata: object.metadata,
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
      this.persistBucket(bucketName);
      logger.verboso(`🗑️ Delete S3: ${bucketName}/${key}`);
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
          const prefixPath = prefix + afterPrefix.substring(0, delimiterIndex + 1);
          commonPrefixes.add(prefixPath);
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

  extractMetadata(headers) {
    const metadata = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith("x-amz-meta-")) {
        const metaKey = key.replace("x-amz-meta-", "");
        metadata[metaKey] = value;
      }
    }
    return metadata;
  }

  persistBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (bucket) {
      const objectsObj = {};
      for (const [key, obj] of bucket.objects.entries()) {
        objectsObj[key] = {
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          contentType: obj.contentType,
          metadata: obj.metadata,
          lastModified: obj.lastModified,
          content: obj.content,
        };
      }
      this.store.write(bucketName, objectsObj);
      this.persistBuckets();
    }
  }

  clearBucket(bucketName) {
    const bucket = this.buckets.get(bucketName);
    if (bucket) {
      bucket.objects.clear();
      bucket.objectCount = 0;
      bucket.totalSize = 0;
      this.persistBucket(bucketName);
    }
  }

  getStats() {
    return {
      bucketsCount: this.buckets.size,
      totalObjects: this.getTotalObjectsCount(),
      buckets: Array.from(this.buckets.keys()),
    };
  }

  generateListBucketsResponse(buckets) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Owner>
    <ID>local-simulator</ID>
    <DisplayName>local-simulator</DisplayName>
  </Owner>
  <Buckets>
    ${buckets
      .map(
        (bucket) => `
      <Bucket>
        <Name>${bucket.Name}</Name>
        <CreationDate>${bucket.CreationDate}</CreationDate>
      </Bucket>
    `,
      )
      .join("")}
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
  ${data.contents
    .map(
      (obj) => `
    <Contents>
      <Key>${obj.Key}</Key>
      <LastModified>${obj.LastModified}</LastModified>
      <ETag>${obj.ETag}</ETag>
      <Size>${obj.Size}</Size>
      <StorageClass>${obj.StorageClass}</StorageClass>
    </Contents>
  `,
    )
    .join("")}
  ${data.commonPrefixes
    .map(
      (prefix) => `
    <CommonPrefixes>
      <Prefix>${prefix}</Prefix>
    </CommonPrefixes>
  `,
    )
    .join("")}
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
  ${data.contents
    .map(
      (obj) => `
    <Contents>
      <Key>${obj.Key}</Key>
      <LastModified>${obj.LastModified}</LastModified>
      <ETag>${obj.ETag}</ETag>
      <Size>${obj.Size}</Size>
      <StorageClass>${obj.StorageClass}</StorageClass>
    </Contents>
  `,
    )
    .join("")}
  ${data.commonPrefixes
    .map(
      (prefix) => `
    <CommonPrefixes>
      <Prefix>${prefix}</Prefix>
    </CommonPrefixes>
  `,
    )
    .join("")}
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
