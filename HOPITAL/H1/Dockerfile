FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY proxy1.js .

EXPOSE 4000
CMD ["node", "proxy1.js"]