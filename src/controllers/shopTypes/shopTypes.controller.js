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
        deleteCacheByPattern(`catalog:master:items:shop:*:${shop.id}:*`),
        deleteCacheByPattern(`buyer:shop:full:${shop.id}`),
        deleteCacheByPattern(`buyer:shop:${shop.id}:*`),
        shop.slug ? deleteCacheByPattern(`buyer:shop:slug:${shop.slug}`) : Promise.resolve()
    ]);
};

const invalidateShopTypeFeatureCaches = async()=>{
    await Promise.all([
        deleteCacheByPattern("catalog:shop:*"),
        deleteCacheByPattern("catalog:master:items:*"),
        deleteCacheByPattern("buyer:shop:*")
    ]);
};

const formatMappedItem = (mapping)=>({
    id:mapping.item.id,
    name:mapping.item.name,
    description:mapping.item.description,
    imageUrl:mapping.item.imageUrl,
    sortOrder:mapping.sortOrder,
    itemSortOrder:mapping.item.sortOrderId,
    active:mapping.item.active,
    category:mapping.item.category ? {
        id:mapping.item.category.id,
        name:mapping.item.category.name,
        slug:mapping.item.category.slug
    } : null
});

const shopTypeItemSelect = {
    id:true,
    name:true,
    slug:true,
    active:true,
    catalogItems:{
        orderBy:[
            {sortOrder:"asc"},
            {item:{sortOrderId:"asc"}}
        ],
        select:{
            sortOrder:true,
            item:{
                select:{
                    id:true,
                    name:true,
                    description:true,
                    imageUrl:true,
                    sortOrderId:true,
                    active:true,
                    category:{
                        select:{
                            id:true,
                            name:true,
                            slug:true
                        }
                    }
                }
            }
        }
    }
};

const parseItemMappingInput = (req)=>{
    const rawItems = req.body.items || req.body.itemIds || req.body.itemNames;
    if(!Array.isArray(rawItems) || rawItems.length === 0){
        throw new apiError(400,"items must be a non-empty array");
    }

    return rawItems.map((item,index)=>{
        if(typeof item === "string"){
            return {
                id:item,
                name:item,
                sortOrder:index
            };
        }

        const itemName = item.name || item.itemName;
        return {
            id:item.id || item.itemId,
            name:itemName,
            sortOrder:item.sortOrder ?? index
        };
    });
};

const resolveItemsForShopType = async(requestedItems)=>{
    const itemWhere = requestedItems
        .map((item)=>{
            const conditions = [];
            if(item.id !== undefined && item.id !== null) conditions.push({id:String(item.id)});
            if(item.name) conditions.push({name:{equals:String(item.name),mode:"insensitive"}});
            return conditions.length ? {OR:conditions} : null;
        })
        .filter(Boolean);

    if(itemWhere.length !== requestedItems.length){
        throw new apiError(400,"item id or name is required");
    }

    const items = await prisma.items.findMany({
        where:{
            OR:itemWhere
        },
        select:{
            id:true,
            name:true
        }
    });

    const missingItems = requestedItems.filter((requestedItem)=>{
        return !items.some((item)=>{
            return item.id === String(requestedItem.id) ||
                item.name.toLowerCase() === requestedItem.name?.toLowerCase();
        });
    });

    if(missingItems.length > 0){
        const missingNames = missingItems.map((item)=>item.name || item.id);
        throw new apiError(404,`items not found: ${missingNames.join(", ")}`);
    }

    return requestedItems.map((requestedItem)=>{
        const item = items.find((row)=>{
            return row.id === String(requestedItem.id) ||
                row.name.toLowerCase() === requestedItem.name?.toLowerCase();
        });
        return {
            itemId:item.id,
            sortOrder:Number(requestedItem.sortOrder ?? 0)
        };
    });
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

const fetchShopTypeItems = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const shopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:shopTypeItemSelect
    });

    if(!shopType) throw new apiError(404,"shop type not found");

    return res.status(200).json(new apiResponse(200,{
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        active:shopType.active,
        items:shopType.catalogItems.map(formatMappedItem)
    },"shop type items fetched successfully"));
});

const updateShopTypeItems = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const existingShopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:{id:true}
    });
    if(!existingShopType) throw new apiError(404,"shop type not found");

    const requestedItems = parseItemMappingInput(req);
    const itemMappings = await resolveItemsForShopType(requestedItems);

    await prisma.$transaction([
        prisma.shopTypeItem.deleteMany({
            where:{shopTypeId}
        }),
        ...itemMappings.map((mapping)=>prisma.shopTypeItem.create({
            data:{
                shopTypeId,
                itemId:mapping.itemId,
                sortOrder:mapping.sortOrder
            }
        }))
    ]);

    const shopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:shopTypeItemSelect
    });

    await invalidateShopTypeFeatureCaches();

    return res.status(200).json(new apiResponse(200,{
        id:shopType.id,
        name:shopType.name,
        slug:shopType.slug,
        active:shopType.active,
        items:shopType.catalogItems.map(formatMappedItem)
    },"shop type items updated successfully"));
});

const deleteShopTypeItems = asyncHandler(async(req,res)=>{
    const {shopTypeId} = req.params;
    if(!shopTypeId) throw new apiError(400,"shop type id is required");

    const existingShopType = await prisma.shopType.findUnique({
        where:{id:shopTypeId},
        select:{id:true,name:true,slug:true,active:true}
    });
    if(!existingShopType) throw new apiError(404,"shop type not found");

    await prisma.shopTypeItem.deleteMany({
        where:{shopTypeId}
    });

    await invalidateShopTypeFeatureCaches();

    return res.status(200).json(new apiResponse(200,{
        ...existingShopType,
        items:[]
    },"shop type items reset successfully"));
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
    fetchShopTypeItems,
    fetchShopTypeById,
    fetchShopTypes,
    updateShopTypeItems,
    updateShopFeatureOverrides,
    deleteShopTypeItems,
    updateShopType
};
