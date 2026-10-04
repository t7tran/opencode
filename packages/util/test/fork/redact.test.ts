// fork_change - new file
//
// The data privacy guard's redaction (src/fork/redact.ts).

import { describe, expect, test } from "bun:test"
import {
  buildRedactor,
  collectSecretValues,
  isSecretName,
  plausibleSecret,
  redactDeep,
  secretEnvValues,
  stripSecretEnv,
} from "../../src/fork/redact.js"

const KEY = "gx-live-9f8e7d6c5b4a3210"

describe("literals", () => {
  const redact = buildRedactor({ literals: [KEY] })

  test("the value itself", () => {
    expect(redact(`key is ${KEY}.`)).toBe("key is <API_KEY>.")
  })

  test("the encodings a shell can apply", () => {
    const bytes = Buffer.from(KEY)
    expect(redact(bytes.toString("base64"))).not.toContain(bytes.toString("base64").slice(0, 12))
    expect(redact(bytes.toString("base64url"))).toBe("<API_KEY>")
    expect(redact(bytes.toString("hex"))).toBe("<API_KEY>")
    expect(redact(bytes.toString("hex").toUpperCase())).toBe("<API_KEY>")
    expect(redact([...KEY].reverse().join(""))).toBe("<API_KEY>")
  })

  test("`echo key | base64`, whose trailing newline changes only the tail", () => {
    const encoded = Buffer.from(KEY + "\n").toString("base64")
    expect(redact(encoded)).toContain("<API_KEY>")
    expect(redact(encoded)).not.toContain(encoded.slice(0, 16))
  })

  test("short literals are ignored", () => {
    expect(buildRedactor({ literals: ["abc"] })("abc abc")).toBe("abc abc")
  })

  test("the longer of two overlapping literals wins", () => {
    const both = buildRedactor({ literals: ["12345678", "12345678-extended"] })
    expect(both("12345678-extended")).toBe("<API_KEY>")
  })
})

describe("built-in patterns", () => {
  const redact = buildRedactor()

  test.each([
    ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "<API_KEY>"],
    ["sk-proj-ABCDEFGHIJKLMNOPQRSTUV", "<API_KEY>"],
    ["AKIAIOSFODNN7EXAMPLE", "<API_KEY>"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "<API_KEY>"],
    ["xoxb-1234567890-abcdefghij", "<API_KEY>"],
    ["sk_live_abcdefghijklmnop1234", "<API_KEY>"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "<JWT>"],
  ])("%s", (input, placeholder) => {
    expect(redact(`x ${input} y`)).toBe(`x ${placeholder} y`)
  })

  test("PEM private keys, whole", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----"
    expect(redact(`a\n${pem}\nb`)).toBe("a\n<PRIVATE_KEY>\nb")
  })

  test("bearer tokens keep their scheme", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop1234")).toBe("Authorization: Bearer <SECRET>")
  })

  test("URL passwords, and only the password", () => {
    expect(redact("postgres://app:s3cr3t-pass@db.internal:5432/x")).toBe("postgres://app:<SECRET>@db.internal:5432/x")
  })

  test("env-style lines under a secret name", () => {
    expect(redact("export OPENAI_API_KEY=abc123def456\nPATH=/usr/bin")).toBe(
      "export OPENAI_API_KEY=<SECRET>\nPATH=/usr/bin",
    )
  })

  test("quoted values under a secret name", () => {
    expect(redact(`{"apiKey": "abc123def456"}`)).toBe(`{"apiKey": "<SECRET>"}`)
    expect(redact(`password: 'hunter2hunter2'`)).toBe(`password: '<SECRET>'`)
  })

  test("leaves code and placeholders alone", () => {
    const code = [
      "const apiKey = process.env.API_KEY",
      `apiKey: "{env:GENIX_KEY}"`,
      `token: "<API_KEY>"`,
      "SSH_AUTH_SOCK=/tmp/ssh-abc123/agent.1",
      `name: "ordinary words here"`,
    ].join("\n")
    expect(redact(code)).toBe(code)
  })
})

describe("hosts", () => {
  test("exact hosts, URLs and wildcards", () => {
    const redact = buildRedactor({ hosts: ["https://gateway.example.com/v1", "*.corp.example.net"] })
    expect(redact("curl https://gateway.example.com/v1/models")).toBe("curl https://<HOST>/v1/models")
    expect(redact("db.eu.corp.example.net and corp.example.net")).toBe("<HOST> and corp.example.net")
    expect(redact("notgateway.example.com")).toBe("notgateway.example.com")
  })
})

describe("extra patterns", () => {
  test("are applied, global flag or not", () => {
    const redact = buildRedactor({ patterns: [/ACME-\d{6}/] })
    expect(redact("ACME-123456 and ACME-654321")).toBe("<SECRET> and <SECRET>")
  })
})

describe("env", () => {
  test("strips secret names, keeps the rest", () => {
    const removed: string[] = []
    const out = stripSecretEnv(
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "sk-1",
        GH_TOKEN: "ghp-1",
        DB_PASSWORD: "pw",
        SSH_AUTH_SOCK: "/tmp/sock",
        GIT_AUTHOR_NAME: "Someone",
        GENIXCODE_FORK_KEY_FILE: "/x",
        OPENCODE_SERVER_PASSWORD: "srv",
      },
      new Set(["GH_TOKEN", "OPENCODE_SERVER_PASSWORD"]),
      (value) => removed.push(value),
    )
    expect(out).toEqual({ PATH: "/usr/bin", GH_TOKEN: "ghp-1", SSH_AUTH_SOCK: "/tmp/sock", GIT_AUTHOR_NAME: "Someone" })
    expect(removed.sort()).toEqual(["/x", "pw", "sk-1", "srv"])
  })

  test("secret values by name", () => {
    expect(
      secretEnvValues({ HOME: "/home/x", AWS_SECRET_ACCESS_KEY: "abc123def456", HF_TOKEN_PATH: "/x/token", EMPTY_TOKEN: "" }),
    ).toEqual(["abc123def456"])
  })

  test("names", () => {
    expect(isSecretName("ANTHROPIC_API_KEY")).toBe(true)
    expect(isSecretName("apiKey")).toBe(true)
    expect(isSecretName("GIT_AUTHOR_EMAIL")).toBe(false)
    expect(isSecretName("SSH_AUTH_SOCK")).toBe(false)
  })
})

describe("structures", () => {
  test("collects plausible secrets under secret names, not every header", () => {
    expect(
      collectSecretValues({
        baseURL: "https://x",
        apiKey: "key-123456789",
        headers: { "Content-Type": "application/json", Authorization: "Bearer abcdef123456" },
        nested: [{ password: "pass-98765432", other: "other-value-1234" }],
        tokenPath: "/home/u/.cache/token",
      }).sort(),
    // The Authorization value has a space, so it is left to the Bearer pattern.
    ).toEqual(["key-123456789", "pass-98765432"])
  })

  test("plausible secrets", () => {
    expect(plausibleSecret("abc123def456")).toBe(true)
    expect(plausibleSecret("averylongsecretwithnodigits")).toBe(true)
    expect(plausibleSecret("short1")).toBe(false)
    expect(plausibleSecret("/home/u/.cache/token")).toBe(false)
    expect(plausibleSecret("https://auth.example.com")).toBe(false)
    expect(plausibleSecret("application")).toBe(false)
  })

  test("redactDeep walks plain data and keeps references when unchanged", () => {
    const redact = buildRedactor({ literals: [KEY] })
    const clean = { a: ["x", { b: "y" }] }
    expect(redactDeep(clean, redact)).toBe(clean)
    const dirty = { a: ["x", { b: KEY, uri: KEY }] }
    expect(redactDeep(dirty, redact, new Set(["uri"]))).toEqual({ a: ["x", { b: "<API_KEY>", uri: KEY }] })
  })

  test("redactDeep leaves class instances alone", () => {
    class Asset {
      constructor(readonly data: string) {}
    }
    const asset = new Asset(KEY)
    expect(redactDeep({ asset }, buildRedactor({ literals: [KEY] })).asset).toBe(asset)
  })
})
