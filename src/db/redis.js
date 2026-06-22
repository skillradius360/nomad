import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

const redis = process.env.REDIS_URL
    ? new Redis(redisUrl,{
        lazyConnect:true,
        maxRetriesPerRequest:1,
        enableOfflineQueue:false
    })
    : null;

if(redis){
    redis.on("connect",()=>{
        console.log("Redis cache connected");
    });

    redis.on("ready",()=>{
        console.log("Redis cache ready");
    });

    redis.on("error",(error)=>{
        console.error("Redis cache error:",error.message);
    });

    redis.on("close",()=>{
        console.warn("Redis cache connection closed");
    });

    redis.connect().catch((error)=>{
        console.error("Redis cache connection failed:",error.message);
    });
}else{
    console.warn("Redis cache disabled: REDIS_URL is not configured");
}

export { redis };
