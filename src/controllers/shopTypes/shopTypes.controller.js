import { prisma } from "../../db/index.js";
import { deleteCacheByPattern } from "../../utils/cache.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import {
    allowedShopFeatures,
    formatShopFeatureSummary,
    normalizeShopFeature,
    normalizeShopFeatures,
    shopFeatureSelect
} from "../../utils/shopFeatures.js";

const invalidateShopFeatureCaches = async(shop)=>{
    await Promise.all([
        deleteCacheByPattern(`catalog:shop:${shop.id}:*`),
        deleteCacheByPattern(`buyer:shop:full:${shop.id}`),
        deleteCacheByPattern(`buyer:shop:${shop.id}:*`),
        shop.slug ? deleteCacheByPattern(`buyer:shop:slug:${shop.slug}`) : Promise.resolve()
    ]);
};

const invalidateShopTypeFeatureCaches = async()=>{
    await Promise.all([
        deleteCacheByPattern("catalog:shop:*"),
        deleteCacheByPattern("buyer:shop:*")
    ]);
};

const createShopType = asyncHandler(async(req,res)=>{
    const {name,description,features = [],active = true} = req.body;

    if(!name || !String(name).trim()) throw new apiError(400,"shop type name is required");
    if(!Array.isArray(features) || features.length === 0) throw new apiError(400,"features must be a non-empty array");

    const normalizedFeatures = [...new Set(features.map((feature)=>String(feature).trim().toUpperCase()).filter(Boolean))];
    const invalidFeatures = normalizedFeatures.filter((feature)=>!allowedShopFeatures.includes(feature));
    if(invalidFeatures.length) throw new apiError(400,`invalid features: ${invalidFeatures.join(", ")}`);

    const slug = String(req.body.slug || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");
    if(!slug) throw new apiError(400,"shop type slug is required");

    const shopType = await prisma.shopType.create({
        data:{
            name:String(name).trim(),
            slug,
            description:description === undefined ? undefined : String(description).trim(),
            active:Boolean(active),
            features:{
                create:normalizedFeatures.map((feature)=>({
                    feature,
                    enabled:true
                }))
            }
        },
        select:{
            id:true,
            name:true,
            slug:true,
            description:true,
            active:true,
            features:{
                where:{enabled:true},
                select:{feature:true}
            }
        }
    });

    return res.status(201).json(new apiResponse(201,{
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        description:shopType.description,
        active:shopType.active,
        features:shopType.features.map((feature)=>feature.feature)
    },"shop type created successfully"));
});

const fetchShopTypes = asyncHandler(async(req,res)=>{
    const includeInactive = String(req.query.includeInactive || "false").toLowerCase() === "true";
    const shopTypes = await prisma.shopType.findMany({
        where:includeInactive ? {} : {active:true},
        orderBy:{createdAt:"desc"},
        select:{
            id:true,
            name:true,
            slug:true,
            description:true,
            active:true,
            features:{
                where:{enabled:true},
                select:{feature:true}
            }
        }
    });

    return res.status(200).json(new apiResponse(200,shopTypes.map((shopType)=>({
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        description:shopType.description,
        active:shopType.active,
        features:shopType.features.map((feature)=>feature.feature)
    })),"shop types fetched successfully"));
});

const fetchShopTypeById = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const shopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:{
            id:true,
            name:true,
            slug:true,
            description:true,
            active:true,
            features:{
                where:{enabled:true},
                select:{feature:true}
            }
        }
    });

    if(!shopType) throw new apiError(404,"shop type not found");

    return res.status(200).json(new apiResponse(200,{
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        description:shopType.description,
        active:shopType.active,
        features:shopType.features.map((feature)=>feature.feature)
    },"shop type fetched successfully"));
});

const updateShopType = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    const {name,description,features,active} = req.body;

    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const existingShopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:{id:true}
    });
    if(!existingShopType) throw new apiError(404,"shop type not found");

    const dataToUpdate = {};
    if(name !== undefined){
        if(!String(name).trim()) throw new apiError(400,"shop type name cannot be empty");
        dataToUpdate.name = String(name).trim();
    }
    if(description !== undefined) dataToUpdate.description = String(description).trim();
    if(active !== undefined) dataToUpdate.active = Boolean(active);

    if(features !== undefined){
        if(!Array.isArray(features) || features.length === 0) throw new apiError(400,"features must be a non-empty array");
        const normalizedFeatures = [...new Set(features.map((feature)=>String(feature).trim().toUpperCase()).filter(Boolean))];
        const invalidFeatures = normalizedFeatures.filter((feature)=>!allowedShopFeatures.includes(feature));
        if(invalidFeatures.length) throw new apiError(400,`invalid features: ${invalidFeatures.join(", ")}`);
        dataToUpdate.features = {
            deleteMany:{},
            create:normalizedFeatures.map((feature)=>({
                feature,
                enabled:true
            }))
        };
    }

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no shop type data passed");

    const shopType = await prisma.shopType.update({
        where:{id:shopTypeId},
        data:dataToUpdate,
        select:{
            id:true,
            name:true,
            slug:true,
            description:true,
            active:true,
            features:{
                where:{enabled:true},
                select:{feature:true}
            }
        }
    });

    await invalidateShopTypeFeatureCaches();
    return res.status(200).json(new apiResponse(200,{
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        description:shopType.description,
        active:shopType.active,
        features:shopType.features.map((feature)=>feature.feature)
    },"shop type updated successfully"));
});

const fetchShopFeatureOverrides = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            slug:true,
            ...shopFeatureSelect
        }
    });

    if(!shop) throw new apiError(404,"shop not found");

    return res.status(200).json(new apiResponse(200,formatShopFeatureSummary(shop),"shop features fetched successfully"));
});

const updateShopFeatureOverrides = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const {feature,features,enabled = true,overrides} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            slug:true,
            ...shopFeatureSelect
        }
    });

    if(!shop) throw new apiError(404,"shop not found");

    const requestedOverrides = Array.isArray(overrides)
        ? overrides.map((override)=>({
            feature:normalizeShopFeature(override.feature),
            enabled:Boolean(override.enabled)
        }))
        : normalizeShopFeatures(features || (feature ? [feature] : [])).map((normalizedFeature)=>({
            feature:normalizedFeature,
            enabled:Boolean(enabled)
        }));

    const uniqueOverrides = [...new Map(requestedOverrides.map((override)=>[override.feature,override])).values()];

    await prisma.$transaction(
        uniqueOverrides.map((override)=>prisma.shopFeatureOverride.upsert({
            where:{
                shopId_feature:{
                    shopId,
                    feature:override.feature
                }
            },
            update:{
                enabled:override.enabled
            },
            create:{
                shopId,
                feature:override.feature,
                enabled:override.enabled
            }
        }))
    );

    const updatedShop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            slug:true,
            ...shopFeatureSelect
        }
    });

    await invalidateShopFeatureCaches(updatedShop);

    return res.status(200).json(new apiResponse(200,formatShopFeatureSummary(updatedShop),"shop feature overrides updated successfully"));
});

const deleteShopFeatureOverrides = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const {feature,features} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");

    const normalizedFeatures = normalizeShopFeatures(features || (feature ? [feature] : []));

    const shop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            slug:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");

    await prisma.shopFeatureOverride.deleteMany({
        where:{
            shopId,
            feature:{
                in:normalizedFeatures
            }
        }
    });

    const updatedShop = await prisma.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            shopName:true,
            slug:true,
            ...shopFeatureSelect
        }
    });

    await invalidateShopFeatureCaches(updatedShop);

    return res.status(200).json(new apiResponse(200,formatShopFeatureSummary(updatedShop),"shop feature overrides reset successfully"));
});

const deleteShopType = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const assignedShopCount = await prisma.shop.count({
        where:{shopTypeId}
    });

    if(assignedShopCount > 0) throw new apiError(409,"shop type is assigned to shops");

    const deletedShopType = await prisma.shopType.delete({
        where:{id:shopTypeId},
        select:{id:true,name:true,slug:true}
    });

    return res.status(200).json(new apiResponse(200,deletedShopType,"shop type deleted successfully"));
});

export {
    createShopType,
    deleteShopType,
    deleteShopFeatureOverrides,
    fetchShopFeatureOverrides,
    fetchShopTypeById,
    fetchShopTypes,
    updateShopFeatureOverrides,
    updateShopType
};
