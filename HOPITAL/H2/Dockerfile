FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY proxy.js .

EXPOSE 4001
CMD ["node", "proxy.js"]