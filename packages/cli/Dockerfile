FROM alpine AS base

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep

FROM base AS build-amd64
# fork_change start - renamed binary
COPY dist/cli-linux-x64-baseline-musl/bin/genixcode /usr/local/bin/genixcode
# fork_change end

FROM base AS build-arm64
# fork_change start - renamed binary
COPY dist/cli-linux-arm64-musl/bin/genixcode /usr/local/bin/genixcode
# fork_change end

ARG TARGETARCH
FROM build-${TARGETARCH}
# fork_change start - renamed binary
RUN ln -s genixcode /usr/local/bin/genixcode2 && genixcode --version && genixcode2 --version
ENTRYPOINT ["genixcode"]
# fork_change end
