import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CV_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CV_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const FOLDERS = {
  productImage: "product-images",
  productImages: "product-images",
  cv: "cvs",
  cvs: "cvs",
  tryOn: "try-on",
};

function required(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(`${name} is not configured`), { status: 500 });
  return value;
}

function safeFilename(filename = "upload") {
  const clean = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "upload";
}

function publicBaseUrl() {
  return (process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
}

export function getR2PublicUrl(key) {
  const base = publicBaseUrl();
  return base ? `${base}/${key}` : null;
}

export function assertUploadAllowed({ uploadType, contentType, contentLength }) {
  const folder = FOLDERS[uploadType];
  if (!folder) throw Object.assign(new Error("Unsupported upload type"), { status: 422 });

  const size = Number(contentLength || 0);
  if (!size) throw Object.assign(new Error("File size is required"), { status: 422 });

  if (folder === "cvs") {
    if (!CV_TYPES.has(contentType)) throw Object.assign(new Error("CV must be PDF, DOC, or DOCX"), { status: 422 });
    if (size > MAX_CV_BYTES) throw Object.assign(new Error("CV must be 10MB or smaller"), { status: 422 });
  } else {
    if (!IMAGE_TYPES.has(contentType)) throw Object.assign(new Error("Image must be JPG, PNG, WEBP, or GIF"), { status: 422 });
    if (size > MAX_IMAGE_BYTES) throw Object.assign(new Error("Image must be 8MB or smaller"), { status: 422 });
  }

  return folder;
}

export function createR2Key({ uploadType, filename, userId }) {
  const folder = FOLDERS[uploadType];
  const stamped = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFilename(filename)}`;
  return `${folder}/${userId || "anon"}/${stamped}`;
}

export async function createUploadPresign({ key, contentType }) {
  const bucket = required("R2_BUCKET");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    },
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn: 60 * 5 });
}
