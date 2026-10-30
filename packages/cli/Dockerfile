FROM alpine AS base

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep

FROM base AS build-amd64
# fork_change start - renamed binary
COPY dist/cli-linux-x64-baseline-musl/bin/genixcode-cli /usr/local/bin/genixcode-cli
# fork_change end

FROM base AS build-arm64
# fork_change start - renamed binary
COPY dist/cli-linux-arm64-musl/bin/genixcode-cli /usr/local/bin/genixcode-cli
# fork_change end

ARG TARGETARCH
FROM build-${TARGETARCH}
# fork_change start - renamed binary
RUN ln -s genixcode-cli /usr/local/bin/genixcode-cli2 && genixcode-cli --version && genixcode-cli2 --version
ENTRYPOINT ["genixcode-cli"]
# fork_change end
