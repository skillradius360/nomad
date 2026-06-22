const stores = new Map();

const getClientKey = (req,keyPrefix)=>{
    const userId = req.userData?.id;
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    return `${keyPrefix}:${userId || ip}`;
};

const cleanupStore = (store,now)=>{
    for(const [key,entry] of store.entries()){
        if(entry.resetAt <= now){
            store.delete(key);
        }
    }
};

const createRateLimiter = ({windowMs,max,keyPrefix = "rate-limit",message = "Too many requests. Please try again later."})=>{
    const store = new Map();
    stores.set(keyPrefix,store);

    return (req,res,next)=>{
        const now = Date.now();
        cleanupStore(store,now);

        const key = getClientKey(req,keyPrefix);
        const entry = store.get(key) || {
            count:0,
            resetAt:now + windowMs
        };

        if(entry.resetAt <= now){
            entry.count = 0;
            entry.resetAt = now + windowMs;
        }

        entry.count += 1;
        store.set(key,entry);

        const remaining = Math.max(max - entry.count,0);
        const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);

        res.setHeader("X-RateLimit-Limit",String(max));
        res.setHeader("X-RateLimit-Remaining",String(remaining));
        res.setHeader("X-RateLimit-Reset",String(Math.ceil(entry.resetAt / 1000)));

        if(entry.count > max){
            res.setHeader("Retry-After",String(retryAfterSeconds));
            return res.status(429).json({
                success:false,
                message,
                retryAfterSeconds
            });
        }

        next();
    };
};

const authRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:8,
    keyPrefix:"auth",
    message:"Too many authentication requests. Please try again shortly."
});

const expensiveReadRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:60,
    keyPrefix:"expensive-read"
});

const buyerReadRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:120,
    keyPrefix:"buyer-read",
    message:"Too many buyer read requests. Please try again shortly."
});

const writeRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:30,
    keyPrefix:"write"
});

const checkoutRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:10,
    keyPrefix:"checkout",
    message:"Too many checkout attempts. Please try again shortly."
});

const uploadRateLimit = createRateLimiter({
    windowMs:5 * 60 * 1000,
    max:15,
    keyPrefix:"upload",
    message:"Too many upload requests. Please try again later."
});

const adminHeavyRateLimit = createRateLimiter({
    windowMs:60 * 1000,
    max:20,
    keyPrefix:"admin-heavy"
});

export {
    adminHeavyRateLimit,
    authRateLimit,
    buyerReadRateLimit,
    checkoutRateLimit,
    expensiveReadRateLimit,
    uploadRateLimit,
    writeRateLimit
};
