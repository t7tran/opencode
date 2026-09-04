// fork_change - new file
//
// Import-time preload for the fork. Imported as the very first module from
// index.ts so it runs before the Flag module evaluates process.env.
//
// Forces models.dev network fetch off: this build is locked to a single
// self-hosted provider, so there is no reason to contact the models.dev
// catalog endpoint on startup (wasteful + leaks usage metadata).

process.env.OPENCODE_DISABLE_MODELS_FETCH = "1"
