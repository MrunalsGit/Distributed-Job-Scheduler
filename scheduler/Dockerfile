FROM node:20-alpine
WORKDIR /app
COPY scheduler/package*.json ./
RUN npm install --omit=dev
COPY scheduler/src ./src
CMD ["node", "src/index.js"]
