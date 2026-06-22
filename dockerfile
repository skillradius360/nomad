FROM redis/redis-stack-server:latest

EXPOSE 6379

VOLUME ["/data"]

CMD ["redis-stack-server", "--appendonly", "yes"]