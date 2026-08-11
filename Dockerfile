FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run build

ENV NODE_ENV=production
EXPOSE 4173
CMD ["npm", "start"]
