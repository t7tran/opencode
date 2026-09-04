import path from "path"

process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"

// fork_change start - disable the fork's hardcoded provider lock during tests so the
// upstream provider pipeline (anthropic/openai/bedrock/etc.) is exercised unmodified,
// and point the managed key file at a path that never exists so tests never pick up a
// real /etc/kilo.key from the developer's machine.
process.env.KILO_FORK_DISABLE_PROVIDER_LOCK = "1"
process.env.KILO_FORK_KEY_FILE = "/nonexistent/fork-test/kilo.key"
// fork_change end
