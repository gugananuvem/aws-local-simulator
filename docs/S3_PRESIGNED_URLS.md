# S3 Presigned URLs API Reference

> Complete documentation for S3 Presigned URLs in AWS Local Simulator

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

**Presigned URLs** are time-limited URLs that allow clients to access S3 objects without permanent AWS credentials. The AWS Local Simulator supports full presigned URL generation with AWS Signature V4 signing.

### When to Use Presigned URLs

| Scenario | Use Case |
|----------|----------|
| **Frontend uploads** | Allow web users to upload files directly to S3 without exposing AWS credentials |
| **Secure downloads** | Share time-limited download links without giving permanent access |
| **Third-party access** | Grant temporary access to specific objects |
| **Mobile apps** | Allow mobile apps to upload/download from S3 securely |
| **Webhook deliveries** | Send signed URLs that expire after delivery |

### Key Features

- ✅ **AWS Signature V4** - Industry-standard signing
- ✅ **Configurable expiration** - From 1 second to several days
- ✅ **Method-specific** - URLs are tied to HTTP method (GET, PUT, DELETE, HEAD)
- ✅ **POST policies** - Support for HTML form-based uploads
- ✅ **Validation** - Built-in URL validation endpoint
- ✅ **Custom credentials** - Support for custom AWS credentials

---

## Quick Start

### 1. Generate a Download Link

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/get \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "documents/report.pdf",
    "expiresIn": 3600
  }'
```

**Response:**
```json
{
  "presignedUrl": "http://localhost:4566/my-bucket/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

### 2. Use the URL

```bash
# Anyone can download using this link (no AWS credentials needed)
curl -O "http://localhost:4566/my-bucket/documents/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&..."
```

### 3. Generate an Upload Link

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/put \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "uploads/user-photo.jpg",
    "contentType": "image/jpeg",
    "expiresIn": 1800
  }'
```

### 4. Upload Using the Link

```bash
curl -X PUT \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg \
  "http://localhost:4566/my-bucket/uploads/user-photo.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&..."
```

---

## API Reference

### Base URL

```
http://localhost:4566/__admin/presigned-urls
```

### Endpoints

#### 1. Generate Presigned GET URL

Generate a URL for downloading an object.

```http
POST /__admin/presigned-urls/get
Content-Type: application/json

{
  "bucket": "string (required)",
  "key": "string (required)",
  "expiresIn": "number (optional, default: 3600)",
  "credentials": "object (optional)"
}
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | S3 bucket name |
| `key` | string | Yes | Object key/path |
| `expiresIn` | number | No | Expiration time in seconds (default: 3600) |
| `credentials` | object | No | Custom AWS credentials (accessKeyId, secretAccessKey, sessionToken) |

**Response (200 OK):**

```json
{
  "presignedUrl": "string",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/get \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "files/document.pdf",
    "expiresIn": 7200
  }'
```

---

#### 2. Generate Presigned PUT URL

Generate a URL for uploading an object.

```http
POST /__admin/presigned-urls/put
Content-Type: application/json

{
  "bucket": "string (required)",
  "key": "string (required)",
  "contentType": "string (optional)",
  "expiresIn": "number (optional, default: 3600)",
  "credentials": "object (optional)"
}
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | S3 bucket name |
| `key` | string | Yes | Object key/path |
| `contentType` | string | No | MIME type for the upload |
| `expiresIn` | number | No | Expiration time in seconds (default: 3600) |
| `credentials` | object | No | Custom AWS credentials |

**Response (200 OK):**

```json
{
  "presignedUrl": "string",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/put \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "uploads/avatar.jpg",
    "contentType": "image/jpeg",
    "expiresIn": 1800
  }'
```

---

#### 3. Generate Presigned DELETE URL

Generate a URL for deleting an object.

```http
POST /__admin/presigned-urls/delete
Content-Type: application/json

{
  "bucket": "string (required)",
  "key": "string (required)",
  "expiresIn": "number (optional, default: 3600)",
  "credentials": "object (optional)"
}
```

**Response (200 OK):**

```json
{
  "presignedUrl": "string",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

---

#### 4. Generate Presigned HEAD URL

Generate a URL for checking object metadata.

```http
POST /__admin/presigned-urls/head
Content-Type: application/json

{
  "bucket": "string (required)",
  "key": "string (required)",
  "expiresIn": "number (optional, default: 3600)",
  "credentials": "object (optional)"
}
```

**Response (200 OK):**

```json
{
  "presignedUrl": "string",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

---

#### 5. Generate Presigned POST Policy

Generate a POST policy for form-based uploads (HTML forms).

```http
POST /__admin/presigned-urls/post-policy
Content-Type: application/json

{
  "bucket": "string (required)",
  "key": "string (required)",
  "expiresIn": "number (optional, default: 3600)",
  "credentials": "object (optional)",
  "contentType": "string (optional)",
  "conditions": "array (optional)"
}
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | S3 bucket name |
| `key` | string | Yes | Object key/path (can include dynamic variables) |
| `expiresIn` | number | No | Expiration time in seconds (default: 3600) |
| `credentials` | object | No | Custom AWS credentials |
| `contentType` | string | No | MIME type restriction |
| `conditions` | array | No | Additional policy conditions |

**Response (200 OK):**

```json
{
  "policy": "string (base64 encoded)",
  "signature": "string",
  "amzAlgorithm": "AWS4-HMAC-SHA256",
  "amzDate": "string (ISO 8601)",
  "amzCredential": "string",
  "expiresIn": 3600,
  "expiresAt": "2026-09-30T20:00:00.000Z"
}
```

**Example with Conditions:**

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/post-policy \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "uploads/file-${timestamp}.pdf",
    "expiresIn": 3600,
    "conditions": [
      ["content-length-range", 0, 10485760],
      ["starts-with", "$Content-Type", "application/pdf"]
    ]
  }'
```

---

#### 6. Validate Presigned URL

Validate whether a presigned URL is still valid.

```http
POST /__admin/presigned-urls/validate
Content-Type: application/json

{
  "url": "string (required)",
  "method": "string (optional, default: GET)",
  "credentials": "object (optional)"
}
```

**Response (200 OK - Valid):**

```json
{
  "valid": true,
  "expiresAt": "2026-09-30T20:00:00.000Z",
  "remainingSeconds": 3597
}
```

**Response (200 OK - Invalid):**

```json
{
  "valid": false,
  "message": "Signature expired"
}
```

**Example:**

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/validate \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:4566/my-bucket/file.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "method": "GET"
  }'
```

---

## Examples

### Example 1: Direct Download URL

Generate a download link to share with non-technical users:

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/get \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "reports-bucket",
    "key": "2026/september/monthly-report.pdf",
    "expiresIn": 86400
  }'
```

### Example 2: Upload from Web Form

Generate a POST policy for direct browser uploads:

```bash
curl -X POST http://localhost:4566/__admin/presigned-urls/post-policy \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "user-uploads",
    "key": "avatars/${timestamp}-${filename}",
    "expiresIn": 900,
    "conditions": [
      ["content-length-range", 0, 5242880],
      ["starts-with", "$Content-Type", "image/"]
    ]
  }'
```

Then use the response in an HTML form:

```html
<form action="http://localhost:4566/user-uploads" method="POST" enctype="multipart/form-data">
  <input type="hidden" name="policy" value="...">
  <input type="hidden" name="X-Amz-Algorithm" value="AWS4-HMAC-SHA256">
  <input type="hidden" name="X-Amz-Credential" value="...">
  <input type="hidden" name="X-Amz-Date" value="...">
  <input type="hidden" name="X-Amz-Signature" value="...">
  
  <input type="file" name="file">
  <button type="submit">Upload Avatar</button>
</form>
```

### Example 3: Backend Integration (Node.js)

```javascript
// Generate upload URL for frontend
async function getPresignedUploadUrl(userId) {
  const response = await fetch('http://localhost:4566/__admin/presigned-urls/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: 'user-uploads',
      key: `users/${userId}/profile-picture.jpg`,
      contentType: 'image/jpeg',
      expiresIn: 1800
    })
  });

  return response.json();
}

// Frontend receives URL and uploads directly
async function uploadProfilePicture(file, presignedUrl) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: file
  });

  if (response.ok) {
    console.log('✅ Upload successful!');
  } else {
    console.error('❌ Upload failed:', response.statusText);
  }
}
```

### Example 4: Temporary Access Control

Share a file for a limited time:

```bash
# Generate a URL that expires in 5 minutes (300 seconds)
curl -X POST http://localhost:4566/__admin/presigned-urls/get \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "sensitive-data",
    "key": "contracts/2026-agreement.pdf",
    "expiresIn": 300
  }'
```

---

## Security Best Practices

### 1. Use Short Expiration Times

```bash
# ✅ Good: 15 minutes for file downloads
"expiresIn": 900

# ✅ Good: 5 minutes for sensitive data
"expiresIn": 300

# ❌ Bad: 24 hours for sensitive operations
"expiresIn": 86400
```

### 2. Specify Content Types

```bash
# ✅ Good: Restrict content type
{
  "bucket": "uploads",
  "key": "documents/report.pdf",
  "contentType": "application/pdf"
}

# ❌ Bad: No content type restriction
{
  "bucket": "uploads",
  "key": "documents/report.pdf"
}
```

### 3. Generate URLs Server-Side Only

```javascript
// ✅ Good: Generate on backend
app.post('/api/upload-url', async (req, res) => {
  const url = await generatePresignedUrl(...);
  res.json({ url });
});

// ❌ Bad: Never expose credentials to frontend
const s3 = new AWS.S3({
  accessKeyId: 'YOUR_KEY',    // Don't do this!
  secretAccessKey: 'SECRET'    // Don't do this!
});
```

### 4. Validate on Backend

```javascript
// ✅ Good: Verify the upload was successful
app.post('/api/upload-complete', async (req, res) => {
  const { bucket, key } = req.body;
  
  // Verify file exists and matches expected properties
  const metadata = await s3.headObject({ Bucket: bucket, Key: key });
  if (metadata.ContentLength === expectedSize) {
    res.json({ success: true });
  }
});
```

### 5. Implement Rate Limiting

```javascript
// ✅ Good: Rate limit URL generation
const limiter = rateLimit({
  windowMs: 60000,  // 1 minute
  max: 10           // 10 requests per minute
});

app.post('/api/presigned-url', limiter, async (req, res) => {
  // Generate URL
});
```

### 6. Use CloudTrail for Auditing

```bash
# Enable CloudTrail to log all presigned URL usage
aws cloudtrail start-logging \
  --trail-name my-trail \
  --endpoint-url http://localhost:4566
```

---

## Troubleshooting

### URL Returns 403 Forbidden

**Cause:** Signature has expired or is invalid

**Solution:**
```bash
# Check if URL is still valid
curl -X POST http://localhost:4566/__admin/presigned-urls/validate \
  -H "Content-Type: application/json" \
  -d '{"url": "..."}'

# Generate a new URL
curl -X POST http://localhost:4566/__admin/presigned-urls/get ...
```

### URL Returns 404 Not Found

**Cause:** Object does not exist (for GET requests)

**Solution:**
- For GET: Ensure the object has been uploaded first
- For PUT: This is normal - presigned PUT URLs work even if object doesn't exist

### Content-Type Mismatch

**Cause:** Provided Content-Type doesn't match presigned URL

**Solution:**
```bash
# Generate URL with specific content type
curl -X POST http://localhost:4566/__admin/presigned-urls/put \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "my-bucket",
    "key": "file.pdf",
    "contentType": "application/pdf"
  }'

# Use exact same content type in request
curl -X PUT \
  -H "Content-Type: application/pdf" \
  --data-binary @file.pdf \
  "presigned-url"
```

### Access Denied from Frontend

**Cause:** CORS policy blocking presigned URL requests

**Solution:**
- Presigned URLs work with CORS because they're signed
- Ensure Content-Type headers match in browser and URL generation
- Check browser console for CORS error details

---

## Advanced Usage

### Using with AWS SDK

```javascript
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  endpoint: "http://localhost:4566",
  region: "us-east-1"
});

const url = await getSignedUrl(
  s3,
  new GetObjectCommand({
    Bucket: "my-bucket",
    Key: "file.pdf"
  }),
  { expiresIn: 3600 }
);
```

### Using with AWS CLI

```bash
aws s3 presign s3://my-bucket/file.pdf \
  --expires-in 3600 \
  --endpoint-url http://localhost:4566
```

---

## References

- [AWS S3 Presigned URLs Documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [AWS Signature Version 4](https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html)
- [AWS Local Simulator Repository](https://github.com/gugananuvem/aws-local-simulator)
