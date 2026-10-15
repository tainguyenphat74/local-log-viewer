FROM node:22-bookworm-slim
RUN npm install -g pnpm@10.34.7
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm build && mkdir /data && chown node:node /data
USER node
ENV LOGVIEW_HOST=0.0.0.0 PORT=8787 LOGVIEW_STATE=/data/gateway.json
EXPOSE 8787
CMD ["pnpm", "gateway"]
