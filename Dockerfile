FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js simulation.js app.js index.html styles.css ./
USER node
EXPOSE 4173
CMD ["node", "server.js"]
