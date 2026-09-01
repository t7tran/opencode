FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
# fork_change start - renamed binary
COPY dist/opencode-linux-x64-baseline-musl/bin/genixcode /usr/local/bin/genixcode
# fork_change end

FROM base AS build-arm64
# fork_change start - renamed binary
COPY dist/opencode-linux-arm64-musl/bin/genixcode /usr/local/bin/genixcode
# fork_change end

ARG TARGETARCH
FROM build-${TARGETARCH}
# fork_change start - renamed binary
RUN genixcode --version
ENTRYPOINT ["genixcode"]
# fork_change end
