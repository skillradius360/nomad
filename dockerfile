# FROM redis/redis-stack-server:latest

# EXPOSE 6379

# VOLUME ["/data"]

# CMD ["redis-stack-server", "--appendonly", "yes"]

FROM node:latest

WORKDIR /src/app

COPY package.* .
COPY prisma .

RUN npm install 
RUN npx prisma generate

COPY . .

EXPOSE 8000

CMD ["npm","run","dev"]