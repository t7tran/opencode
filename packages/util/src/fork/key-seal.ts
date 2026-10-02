// fork_change - new file
//
// Sealed form of the managed API key file (/etc/kilo.key, see key-file.ts).
//
// The file may hold either the plain API key (the original format, still
// supported unchanged) or a *sealed* blob:
//
//   v1.<base64url(nonce || tag || ciphertext)>
//
// A sealed blob is a single-line, ASCII-only token: safe to drop into a
// Terraform variable, tfvars file, cloud-init `write_files` block, or an SSM /
// Secret Manager parameter with no quoting, escaping, or newline hazards. It is
// also *deterministic* — sealing the same key twice yields byte-identical
// output — so a provisioning plan that renders the blob stays clean instead of
// diffing on every run.
//
// WHAT THIS IS NOT
//
// This is obfuscation, not secrecy. The unsealing secret ships inside the CLI,
// because that is exactly the thing that must be able to use the key. Anyone
// holding a build can recover the plaintext from a blob. What sealing buys:
//
//   - `cat /etc/kilo.key` no longer prints a usable credential, so the key does
//     not leak into shoulder-surfing, screenshots, support bundles, or logs
//     that happen to slurp the file.
//   - The blob is useless to generic tooling — you cannot paste it into `curl`
//     or another OpenAI-compatible client and reach the gateway.
//   - Provisioning pipelines (Terraform state, CI logs, artefact stores) carry
//     the blob rather than the raw key.
//
// A sealed blob still deserves the same handling as a secret. Do not commit it
// to a public repo.
//
// Sealing is authenticated (AES-256-GCM with the version string as AAD), so a
// blob produced by a different build — or a corrupted one — is rejected
// outright rather than silently decrypting to garbage that would later fail as
// a mysterious 401 from the gateway.
//
// See FORK.md.

import crypto from "node:crypto"
import { MissingPepperError, pepperFilePath, readPepperFile } from "./pepper.js"

/** Marker that distinguishes a sealed blob from a plain key. */
export const SEALED_PREFIX = "v1."

/** Bound into the derived keys and the GCM AAD, so v1 blobs cannot be reused under a later format. */
const CONTEXT = "genix/v1"

declare global {
  /** Injected by the build from the out-of-repo pepper file; see fork/pepper.ts. */
  const GENIX_KEY_PEPPER: string
}

/**
 * Build-time obfuscation secret. Not a secret from the machine's users — see
 * the header. Changing it invalidates every previously sealed file, so treat it
 * as a format version: rotate only alongside a re-provisioning of every host.
 *
 * It is not in this repository. The build reads it from a file outside the
 * working tree and bakes it in here, and refuses to produce a binary without
 * one. Running from source (dev, tests) there is no define, so the same file is
 * read at runtime instead — which is why this is a function rather than a
 * module-level constant.
 */
const BUILD_PEPPER = typeof GENIX_KEY_PEPPER === "string" && GENIX_KEY_PEPPER.length > 0 ? GENIX_KEY_PEPPER : undefined

const NONCE_BYTES = 12
const TAG_BYTES = 16

/**
 * `KILO_FORK_KEY_PEPPER` overrides the pepper. Used by the tests to prove that
 * a blob sealed by one build is rejected by another; also lets an operator who
 * builds their own CLI and extension from source use a private pepper. It grants
 * nothing to an attacker: sealing with a pepper of your choosing produces a blob
 * only your own build can read.
 */
function pepper(): Buffer {
  const override = process.env.KILO_FORK_KEY_PEPPER?.trim()
  if (override && override.length > 0) return Buffer.from(override, "utf8")
  const value = BUILD_PEPPER ?? readPepperFile()
  // Only reachable from an unbuilt run with no pepper file: unseal() catches it
  // and reads as "no managed key", seal() surfaces it as the CLI error it is.
  if (!value) throw new MissingPepperError(pepperFilePath())
  return Buffer.from(value, "utf8")
}

/** Sub-key for one purpose. HMAC-SHA256 rather than a password KDF: the pepper is already high-entropy. */
function derive(label: string): Buffer {
  return crypto.createHmac("sha256", pepper()).update(label).digest()
}

/**
 * Nonce derived from the plaintext (synthetic-IV style) rather than drawn at
 * random, which is what makes sealing deterministic and therefore idempotent
 * under Terraform. The cost is that two identical keys seal identically — i.e.
 * a blob reveals whether two hosts share a key. That is not information worth
 * protecting here, and a re-sealing diff on every plan is a real operational cost.
 */
function nonceFor(plain: string): Buffer {
  return crypto
    .createHmac("sha256", derive(`${CONTEXT}/nonce`))
    .update(plain, "utf8")
    .digest()
    .subarray(0, NONCE_BYTES)
}

/** True when the text looks like a sealed blob rather than a plain key. */
export function isSealed(text: string): boolean {
  return text.trimStart().startsWith(SEALED_PREFIX)
}

/** Seal a plain API key into its single-line blob form. */
export function seal(plain: string): string {
  const key = plain.trim()
  if (key.length === 0) throw new Error("cannot seal an empty key")
  const nonce = nonceFor(key)
  const cipher = crypto.createCipheriv("aes-256-gcm", derive(`${CONTEXT}/enc`), nonce)
  cipher.setAAD(Buffer.from(CONTEXT, "utf8"))
  const body = Buffer.concat([cipher.update(key, "utf8"), cipher.final()])
  return SEALED_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url")
}

/**
 * Plain key from a sealed blob, or undefined when the text is not a sealed blob,
 * is truncated, or fails authentication (a different pepper, or tampering).
 */
export function unseal(blob: string): string | undefined {
  const text = blob.trim()
  if (!isSealed(text)) return undefined
  const payload = Buffer.from(text.slice(SEALED_PREFIX.length), "base64url")
  if (payload.length <= NONCE_BYTES + TAG_BYTES) return undefined
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", derive(`${CONTEXT}/enc`), payload.subarray(0, NONCE_BYTES))
    decipher.setAAD(Buffer.from(CONTEXT, "utf8"))
    decipher.setAuthTag(payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES))
    const plain = Buffer.concat([
      decipher.update(payload.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8")
    const key = plain.trim()
    return key.length > 0 ? key : undefined
  } catch {
    return undefined
  }
}

/**
 * The plain key held by the key file, whichever form it is in: a sealed blob is
 * unsealed, anything else is taken as the key itself. Blank content, and a
 * sealed blob this build cannot unseal, both come back undefined — i.e. "no
 * managed key", which is the same answer as an absent file, so the normal
 * interactive login flow takes over rather than the provider wedging on a key
 * that cannot work.
 */
export function unwrapKey(raw: string): string | undefined {
  const text = raw.trim()
  if (text.length === 0) return undefined
  return isSealed(text) ? unseal(text) : text
}

/**
 * Short, stable digest of a plain key. Lets an operator confirm that the key on
 * a host is the one they provisioned without either side revealing it.
 */
export function keyFingerprint(plain: string): string {
  return crypto.createHash("sha256").update(plain.trim(), "utf8").digest("hex").slice(0, 12)
}
