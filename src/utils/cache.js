import { redis } from "../db/redis.js";

const DEFAULT_CACHE_TTL = 60;
const localCache = new Map();
const inFlightCache = new Map();

const patternToRegex = (pattern)=>{
    const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g,"\\$&");
    return new RegExp(`^${escapedPattern.replace(/\*/g,".*")}$`);
}

const getLocalCachedData = (cacheKey)=>{
    const cachedData = localCache.get(cacheKey);
    if(!cachedData) return null;

    if(cachedData.expiresAt <= Date.now()){
        localCache.delete(cacheKey);
        return null;
    }

    return cachedData.data;
}

const setLocalCachedData = (cacheKey,data,ttl = DEFAULT_CACHE_TTL)=>{
    localCache.set(cacheKey,{
        data,
        expiresAt:Date.now() + ttl * 1000
    });
}

const getCachedData = async(cacheKey)=>{
    const localCachedData = getLocalCachedData(cacheKey);
    if(localCachedData) return localCachedData;

    if(!redis) return null;

    const cachedData = await redis.get(cacheKey).catch(()=>null);
    if(!cachedData) return null;

    try{
        const parsedData = JSON.parse(cachedData);
        setLocalCachedData(cacheKey,parsedData);
        return parsedData;
    }catch{
        return null;
    }
}

const setCachedData = async(cacheKey,data,ttl = DEFAULT_CACHE_TTL)=>{
    setLocalCachedData(cacheKey,data,ttl);

    if(redis){
        await redis.set(cacheKey,JSON.stringify(data),"EX",ttl).catch(()=>null);
    }
}

const getOrSetCachedData = async(cacheKey,producer,ttl = DEFAULT_CACHE_TTL)=>{
    const cachedData = await getCachedData(cacheKey);
    if(cachedData) return cachedData;

    if(inFlightCache.has(cacheKey)){
        return inFlightCache.get(cacheKey);
    }

    const pendingData = Promise.resolve()
        .then(producer)
        .then(async(data)=>{
            await setCachedData(cacheKey,data,ttl);
            return data;
        })
        .finally(()=>{
            inFlightCache.delete(cacheKey);
        });

    inFlightCache.set(cacheKey,pendingData);
    return pendingData;
}

const deleteCachedData = async(...cacheKeys)=>{
    const keys = cacheKeys.filter(Boolean);
    if(keys.length === 0) return;

    keys.forEach((cacheKey)=>{
        localCache.delete(cacheKey);
        inFlightCache.delete(cacheKey);
    });

    if(redis){
        await redis.del(...keys).catch(()=>null);
    }
}

const deleteCacheByPattern = async(pattern)=>{
    const localPattern = patternToRegex(pattern);
    for(const cacheKey of localCache.keys()){
        if(localPattern.test(cacheKey)){
            localCache.delete(cacheKey);
        }
    }
    for(const cacheKey of inFlightCache.keys()){
        if(localPattern.test(cacheKey)){
            inFlightCache.delete(cacheKey);
        }
    }

    if(!redis) return;

    let cursor = "0";
    do{
        const [nextCursor,keys] = await redis.scan(cursor,"MATCH",pattern,"COUNT",100).catch(()=>["0",[]]);
        cursor = nextCursor;
        if(keys.length > 0){
            await redis.del(...keys).catch(()=>null);
        }
    }while(cursor !== "0");
}

const clearLocalCache = ()=>{
    localCache.clear();
    inFlightCache.clear();
}

export {
    clearLocalCache,
    deleteCachedData,
    deleteCacheByPattern,
    getCachedData,
    getOrSetCachedData,
    setCachedData
};
