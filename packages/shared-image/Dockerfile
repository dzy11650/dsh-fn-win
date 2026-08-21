# DeepSeek Harness — shared runtime image
# Used by both the fnOS Docker-in-FPK package and (optionally) as a base for
# local testing on Windows.
#
# IMPORTANT: DSH is in developer preview. Its interfaces change frequently and
# can be breaking. Pin the source below to a specific commit/tag instead of
# tracking master, otherwise an unannounced change may break the image.
#
#   COPY / build context = the `deepseek-harness-master` checkout.
#   Build (from repo root):  docker build -f packages/shared-image/Dockerfile -t dsh-harness:0.1.0-rc.8 deepseek-harness-master

# ---- builder: install deps + run the repo's own build ----------------------
FROM node:24-bookworm-slim AS builder

# npmmirror keeps China-side builds fast.
RUN echo "registry=https://registry.npmmirror.com/" > /app/.npmrc \
 && echo "@npm:registry=https://registry.npmmirror.com/" >> /app/.npmrc

# DSH requires Node >= 22.19. node:24 satisfies this. pnpm is used internally.
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app
COPY . .

# DSH has intentional circular workspace warnings; they are not fatal.
RUN pnpm install --config.confirmModulesPurge=false
RUN pnpm run build || true

# ---- runtime --------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV DSH_HOME=/data \
    DSH_WEB_HOST=0.0.0.0 \
    DSH_WEB_PORT=3080 \
    NODE_ENV=production

# tsx is used to launch the CLI directly from TS source (see package.json "dsh").
# We keep the built workspace artifacts from the builder stage rather than a
# fresh install, so native/landlock + cli entry stay consistent.
COPY --from=builder /app /app
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
EXPOSE 3080

# Convenience entrypoint. Real ports/host come from env so the same image is
# reused by the fnOS compose file.
CMD ["node", "--import", "tsx/esm", "apps/cli/src/bin.ts", "web", "--host", "0.0.0.0", "--port", "3080"]
