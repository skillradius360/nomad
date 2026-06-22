import { prisma } from "../../db/index.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { deleteCacheByPattern, getOrSetCachedData } from "../../utils/cache.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const BANNER_CACHE_TTL = 60;
const invalidateBannerCaches = async(shopId)=>{
    if(shopId){
        await deleteCacheByPattern(`buyer:shop:${shopId}:banners`);
        return;
    }
    await deleteCacheByPattern("buyer:shop:*:banners");
};

const bannerInclude = {
    shop:{
        select:{
            id:true,
            shopName:true,
            slug:true,
            ownerId:true
        }
    },
    createdBy:{
        select:{
            id:true,
            name:true,
            email:true,
            role:true
        }
    }
};

const parseBoolean = (value)=>{
    if(typeof value === "boolean") return value;
    if(["true","1","yes","on"].includes(String(value).toLowerCase())) return true;
    if(["false","0","no","off"].includes(String(value).toLowerCase())) return false;
    return null;
};

const parseShopIds = (shopId, shopIds)=>{
    const input = shopIds ?? shopId;
    if(Array.isArray(input)) return [...new Set(input.map(String).filter(Boolean))];
    if(typeof input === "string" && input.trim().startsWith("[")){
        try {
            const parsed = JSON.parse(input);
            if(!Array.isArray(parsed)) throw new Error("not array");
            return [...new Set(parsed.map(String).filter(Boolean))];
        } catch (error) {
            throw new apiError(400,"shopIds must be a valid JSON array");
        }
    }
    return input ? [String(input)] : [];
};

const getCurrentUser = async(userId)=>{
    const currentUser = await prisma.user.findUnique({
        where:{
            id:userId
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    return currentUser;
};

const fetchManageableShops = async(currentUser, shopIds)=>{
    if(!shopIds.length) throw new apiError(400,"shopId or shopIds is required");

    const shops = await prisma.shop.findMany({
        where:{
            id:{
                in:shopIds
            }
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(shops.length !== shopIds.length) throw new apiError(400,"one or more shops are invalid");
    if(currentUser.role === "SELLER" && shops.some((shop)=>shop.ownerId !== currentUser.id)){
        throw new apiError(403,"You can only manage banners for your own shop");
    }

    return shops;
};

const uploadBannerImage = async(req, existingImageUrl)=>{
    const bannerImg = req.files?.bannerImg?.[0]?.path || req.files?.image?.[0]?.path;
    if(!bannerImg) return existingImageUrl;

    const uploadStatus = await cloudUploader(bannerImg);
    if(!uploadStatus?.url) throw new apiError(400,"banner image upload failed");

    return uploadStatus.url;
};

const createBanner = asyncHandler(async(req,res)=>{
    const currentUser = await getCurrentUser(req.userData?.id);
    const { shopId, shopIds, text, imageUrl, active, published } = req.body;

    if(!text || !String(text).trim()) throw new apiError(400,"banner text is required");

    const selectedShopIds = parseShopIds(shopId, shopIds);
    await fetchManageableShops(currentUser, selectedShopIds);

    const finalImageUrl = await uploadBannerImage(req, imageUrl);
    if(!finalImageUrl) throw new apiError(400,"banner image is required");

    const activeInput = active ?? published;
    const parsedActive = activeInput === undefined ? false : parseBoolean(activeInput);
    if(parsedActive === null) throw new apiError(400,"active must be true or false");

    const banners = await prisma.$transaction(selectedShopIds.map((selectedShopId)=>prisma.banner.create({
        data:{
            shopId:selectedShopId,
            createdById:currentUser.id,
            text:String(text).trim(),
            imageUrl:finalImageUrl,
            active:parsedActive
        },
        include:bannerInclude
    })));

    await Promise.all(selectedShopIds.map((selectedShopId)=>invalidateBannerCaches(selectedShopId)));
    return res.status(201).json(new apiResponse(201,selectedShopIds.length === 1 ? banners[0] : banners,"banner created successfully"));
});

const fetchPublishedBannersByShop = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
    if(!shopId) throw new apiError(400,"shop id is required");

    const cacheKey = `buyer:shop:${shopId}:banners`;
    const banners = await getOrSetCachedData(cacheKey,async()=>{
        const shop = await prisma.shop.findUnique({
            where:{
                id:shopId
            },
            select:{
                id:true
            }
        });
        if(!shop) throw new apiError(404,"shop not found");

        return prisma.banner.findMany({
            where:{
                shopId,
                active:true
            },
            select:{
                id:true,
                shopId:true,
                text:true,
                imageUrl:true,
                active:true,
                createdAt:true
            },
            orderBy:{
                createdAt:"desc"
            }
        });
    },BANNER_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,banners,"published banners fetched successfully"));
});

const fetchShopBannersForManage = asyncHandler(async(req,res)=>{
    const currentUser = await getCurrentUser(req.userData?.id);
    const { shopId } = req.params;

    if(!shopId) throw new apiError(400,"shop id is required");
    await fetchManageableShops(currentUser,[shopId]);

    const banners = await prisma.banner.findMany({
        where:{
            shopId
        },
        include:bannerInclude,
        orderBy:{
            createdAt:"desc"
        }
    });

    return res.status(200).json(new apiResponse(200,banners,"shop banners fetched successfully"));
});

const updateBanner = asyncHandler(async(req,res)=>{
    const currentUser = await getCurrentUser(req.userData?.id);
    const { bannerId } = req.params;
    const { text, imageUrl, active, published } = req.body;

    if(!bannerId) throw new apiError(400,"banner id is required");

    const existingBanner = await prisma.banner.findUnique({
        where:{
            id:bannerId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!existingBanner) throw new apiError(404,"banner not found");
    if(currentUser.role === "SELLER" && existingBanner.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage banners for your own shop");
    }

    const dataToUpdate = {};
    if(text !== undefined){
        if(!String(text).trim()) throw new apiError(400,"banner text cannot be empty");
        dataToUpdate.text = String(text).trim();
    }

    const finalImageUrl = await uploadBannerImage(req, imageUrl);
    if(finalImageUrl !== undefined) dataToUpdate.imageUrl = finalImageUrl;

    const activeInput = active ?? published;
    if(activeInput !== undefined){
        const parsedActive = parseBoolean(activeInput);
        if(parsedActive === null) throw new apiError(400,"active must be true or false");
        dataToUpdate.active = parsedActive;
    }

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no banner data passed");

    const banner = await prisma.banner.update({
        where:{
            id:bannerId
        },
        data:dataToUpdate,
        include:bannerInclude
    });

    await invalidateBannerCaches(existingBanner.shop.id);
    return res.status(200).json(new apiResponse(200,banner,"banner updated successfully"));
});

const updateBannerPublishStatus = asyncHandler(async(req,res)=>{
    const currentUser = await getCurrentUser(req.userData?.id);
    const { bannerId } = req.params;
    const active = parseBoolean(req.body.active ?? req.body.published);

    if(!bannerId) throw new apiError(400,"banner id is required");
    if(active === null) throw new apiError(400,"active must be true or false");

    const existingBanner = await prisma.banner.findUnique({
        where:{
            id:bannerId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!existingBanner) throw new apiError(404,"banner not found");
    if(currentUser.role === "SELLER" && existingBanner.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage banners for your own shop");
    }

    const banner = await prisma.banner.update({
        where:{
            id:bannerId
        },
        data:{
            active
        },
        include:bannerInclude
    });

    await invalidateBannerCaches(existingBanner.shop.id);
    return res.status(200).json(new apiResponse(200,banner,`banner ${active ? "published" : "unpublished"} successfully`));
});

const deleteBanner = asyncHandler(async(req,res)=>{
    const currentUser = await getCurrentUser(req.userData?.id);
    const { bannerId } = req.params;

    if(!bannerId) throw new apiError(400,"banner id is required");

    const existingBanner = await prisma.banner.findUnique({
        where:{
            id:bannerId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!existingBanner) throw new apiError(404,"banner not found");
    if(currentUser.role === "SELLER" && existingBanner.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage banners for your own shop");
    }

    const banner = await prisma.banner.delete({
        where:{
            id:bannerId
        }
    });

    await invalidateBannerCaches(existingBanner.shop.id);
    return res.status(200).json(new apiResponse(200,banner,"banner deleted successfully"));
});

export {
    createBanner,
    deleteBanner,
    fetchPublishedBannersByShop,
    fetchShopBannersForManage,
    updateBanner,
    updateBannerPublishStatus
};
