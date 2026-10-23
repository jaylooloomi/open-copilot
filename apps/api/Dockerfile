# Build context = repo root:  docker build -f apps/api/Dockerfile -t open-copilot-api .
FROM node:24-slim AS deps
WORKDIR /app
COPY . .
# Trim the workspace list to the API and its only workspace dependency, then install production deps.
# `npm ci --workspace @oc/api` is not a strict filter: dev/prod flags are computed over the whole
# workspace tree, so packages from other workspaces can end up in the image.
# The lockfile still pins every remaining version; `npm ci` would reject the edited workspace list.
RUN npm pkg delete workspaces \
 && npm pkg set 'workspaces[]=packages/shared' 'workspaces[]=apps/api' \
 && npm install --omit=dev --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production
ENV PORT=8787
# The server listens on 127.0.0.1 by default; inside a container that would make -p unreachable.
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared ./packages/shared
COPY --from=deps /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]
