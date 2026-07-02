import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { deleteCacheByPattern, getOrSetCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { shopHasFeature } from "../../utils/shopFeatures.js";
import { releaseShopSlot, reserveShopSlot } from "../../utils/billing.js";
import {
    calculateShopItemLowestPrice,
    formatShopItemVariantGroups,
    formatShopItemPricing,
    hasShopItemVariants,
    shopItemVariantSelect
} from "../../utils/shopItemVariants.js";

const comboListSelect = {
    id:true,
    shopId:true,
    name:true,
    description:true,
    imageUrl:true,
    totalPrice:true,
    active:true,
    availableQuantity:true,
    sortOrderId:true,
    cuisine:{
        select:{
            id:true,
            name:true,
            slug:true
        }
    },
    category:{
        select:{
            id:true,
            name:true,
            slug:true
        }
    },
    tags:{
        select:{
            tag:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    },
    items:{
        select:{
            id:true,
            quantity:true,
            item:{
                select:{
                    id:true,
                    pricing:true,
                    availableQuantity:true,
                    imageUrl:true,
                    variantGroups:{
                        orderBy:{sortOrder:"asc"},
                        select:shopItemVariantSelect
                    },
                    item:{
                        select:{
                            id:true,
                            name:true,
                            imageUrl:true
                        }
                    }
                }
            }
        }
    }
};

const comboMutationSelect = {
    id:true,
    shopId:true,
    name:true,
    description:true,
    imageUrl:true,
    totalPrice:true,
    active:true,
    availableQuantity:true,
    sortOrderId:true,
    cuisineId:true,
    categoryId:true,
    items:{
        select:{
            id:true,
            itemId:true,
            quantity:true
        }
    }
};

const formatComboListItem = (combo)=>({
    id:combo.id,
    shopId:combo.shopId,
    name:combo.name,
    description:combo.description,
    imageUrl:combo.imageUrl,
    totalPrice:combo.totalPrice,
    active:combo.active,
    availableQuantity:combo.availableQuantity,
    sortOrderId:combo.sortOrderId,
    cuisineId:combo.cuisine?.id || null,
    cuisineName:combo.cuisine?.name || null,
    categoryId:combo.category?.id || null,
    categoryName:combo.category?.name || null,
    tags:combo.tags?.map((tag)=>({
        id:tag.tag?.id,
        name:tag.tag?.name
    })) || [],
    items:combo.items?.map((comboItem)=>({
        id:comboItem.item?.id,
        comboItemId:comboItem.id,
        quantity:comboItem.quantity,
        pricing:comboItem.item?.pricing,
        ...formatShopItemPricing(comboItem.item),
        lowestPrice:calculateShopItemLowestPrice(comboItem.item),
        hasVariants:hasShopItemVariants(comboItem.item),
        variantGroups:formatShopItemVariantGroups(comboItem.item?.variantGroups),
        availableQuantity:comboItem.item?.availableQuantity,
        imageUrl:comboItem.item?.imageUrl || comboItem.item?.item?.imageUrl || null,
        itemId:comboItem.item?.item?.id,
        name:comboItem.item?.item?.name
    })) || []
});

const createCombo = asyncHandler(async(req,res)=>{
    const {
        shopId,
        name,
        description,
        imageUrl,
        cuisineId,
        cuisineName,
        categoryId,
        categoryName,
        active,
        availableQuantity,
        sortOrderId,
        items,
        itemIds
    } = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!name) throw new apiError(400,"combo name is required");

    const selectedItems = Array.isArray(items) && items.length > 0 ? items : itemIds;
    if(!Array.isArray(selectedItems) || selectedItems.length === 0){
        throw new apiError(400,"combo items are required");
    }

    const normalizedItems = selectedItems.map((item)=>{
        if(typeof item === "string") return {itemId:item,quantity:1};
        return {
            itemId:item.itemId || item.id,
            quantity:Number(item.quantity ?? 1)
        };
    });

    if(normalizedItems.some((item)=>!item.itemId)){
        throw new apiError(400,"each combo item needs an itemId");
    }
    if(normalizedItems.some((item)=>!Number.isInteger(item.quantity) || item.quantity < 1)){
        throw new apiError(400,"combo item quantity must be a positive integer");
    }

    const uniqueItemIds = [...new Set(normalizedItems.map((item)=>String(item.itemId)))];
    if(uniqueItemIds.length !== normalizedItems.length){
        throw new apiError(400,"duplicate combo items are not allowed");
    }

    const [currentUser,shop,cuisine,comboItemsData] = await Promise.all([
        prisma.user.findUnique({
            where:{id:req.userData?.id},
            select:{id:true,role:true,isBlocked:true}
        }),
        prisma.shop.findUnique({
            where:{id:shopId},
            select:{
                id:true,
                ownerId:true,
                shopType:{
                    select:{
                        features:{where:{enabled:true},select:{feature:true}}
                    }
                },
                featureOverrides:{select:{feature:true,enabled:true}}
            }
        }),
        cuisineId || cuisineName
            ? prisma.cuisine.findFirst({
                where:cuisineId ? {id:cuisineId} : {
                    OR:[
                        {name:{equals:cuisineName,mode:"insensitive"}},
                        {slug:String(cuisineName).toUpperCase()}
                    ]
                },
                select:{id:true,name:true,slug:true}
            })
            : Promise.resolve(null),
        prisma.shopItem.findMany({
            where:{id:{in:uniqueItemIds},active:true,shopId},
            select:{
                id:true,
                pricing:true,
                variantGroups:{
                    where:{active:true},
                    orderBy:{sortOrder:"asc"},
                    select:shopItemVariantSelect
                }
            }
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    if(!shop) throw new apiError(404,"shop not found");
    if((cuisineId || cuisineName) && !cuisine) throw new apiError(404,"cuisine not found");
    if(comboItemsData.length !== uniqueItemIds.length){
        throw new apiError(404,"one or more selected items were not found for this shop");
    }
    if(!shopHasFeature(shop,"COMBOS")){
        throw new apiError(403,"combos are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CATEGORIES") && (categoryId || categoryName)){
        throw new apiError(403,"categories are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CUISINE") && (cuisineId || cuisineName)){
        throw new apiError(403,"cuisine is not enabled for this shop type");
    }
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage combos for your own shop");
    }

    let category = null;
    if(categoryId || categoryName){
        const categoryWhere = categoryId ? {
            id:categoryId
        } : {
            OR:[
                {name:{equals:categoryName,mode:"insensitive"}},
                {slug:String(categoryName).toUpperCase()}
            ]
        };

        if(cuisine?.id){
            categoryWhere.cuisineId = cuisine.id;
        }

        category = await prisma.categories.findFirst({
            where:categoryWhere
        });

        if(!category){
            throw new apiError(404,cuisine?.id ? "category not found for selected cuisine" : "category not found");
        }
    }

    const shopItemsById = new Map(comboItemsData.map((item)=>[item.id,item]));
    const comboItems = normalizedItems.map((selectedItem)=>{
        const item = shopItemsById.get(String(selectedItem.itemId));

        return {
            item,
            quantity:selectedItem.quantity
        };
    });

    const comboItemKey = comboItems
        .map((comboItem)=>`${comboItem.item.id}:${comboItem.quantity}`)
        .sort()
        .join("|");
    const comboKey = [
        name.trim().toLowerCase(),
        cuisine?.id || "no-cuisine",
        category?.id || "no-category",
        comboItemKey
    ].join("::");

    const comboTotalPrice = Math.round(comboItems.reduce((sum,comboItem)=>{
        const itemPrice = calculateShopItemLowestPrice(comboItem.item);
        return sum + itemPrice * comboItem.quantity;
    },0));

    if(!Number.isFinite(comboTotalPrice) || comboTotalPrice < 0){
        throw new apiError(400,"totalPrice must be a valid number");
    }

    if(comboItems.some((comboItem)=>{
        const itemPrice = calculateShopItemLowestPrice(comboItem.item);
        return !Number.isFinite(itemPrice) || itemPrice < 0;
    })){
        throw new apiError(400,"selected item pricing must be valid non-negative numbers");
    }

    let combo;
    try{
        combo = await prisma.$transaction(async(tx)=>{
            await reserveShopSlot(tx,shopId);
            return tx.combo.create({
        data:{
            shopId,
            name,
            comboKey,
            description,
            imageUrl,
            totalPrice:comboTotalPrice,
            cuisineId:cuisine?.id,
            categoryId:category?.id,
            active:active ?? true,
            availableQuantity:availableQuantity === undefined || availableQuantity === null ? 0 : Number(availableQuantity),
            sortOrderId:sortOrderId === undefined || sortOrderId === null ? undefined : Number(sortOrderId),
            items:{
                create:comboItems.map((comboItem)=>({
                    itemId:comboItem.item.id,
                    quantity:comboItem.quantity
                }))
            }
        },
                select:comboMutationSelect
            });
        });
    }catch(error){
        if(error?.code === "P2002") throw new apiError(409,"same combo already exists for this shop");
        throw error;
    }

    await deleteCacheByPattern(`catalog:shop:${shopId}:combos:*`);
    return res.status(201).json(new apiResponse(201,combo,"combo created successfully"));
});

const editCombo = asyncHandler(async(req,res)=>{
    const {comboId} = req.params;

    if(!comboId) throw new apiError(400,"combo id is required");

    const [existingCombo,currentUser] = await Promise.all([
        prisma.combo.findUnique({
            where:{id:comboId},
            select:{
                id:true,
                shopId:true,
                name:true,
                cuisineId:true,
                categoryId:true,
                totalPrice:true
            }
        }),
        prisma.user.findUnique({
            where:{id:req.userData?.id},
            select:{id:true,role:true,isBlocked:true}
        })
    ]);

    if(!existingCombo) throw new apiError(404,"combo not found");

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const targetShopId = req.body.shopId || existingCombo.shopId;

    const shop = await prisma.shop.findUnique({
        where:{
            id:targetShopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage combos for your own shop");
    }

    let cuisine = null;
    if(req.body.cuisineId || req.body.cuisineName){
        cuisine = await prisma.cuisine.findFirst({
            where:req.body.cuisineId ? {
                id:req.body.cuisineId
            } : {
                OR:[
                    {name:{equals:req.body.cuisineName,mode:"insensitive"}},
                    {slug:String(req.body.cuisineName).toUpperCase()}
                ]
            }
        });

        if(!cuisine) throw new apiError(404,"cuisine not found");
    }

    let category = null;
    if(req.body.categoryId || req.body.categoryName){
        const categoryWhere = req.body.categoryId ? {
            id:req.body.categoryId
        } : {
            OR:[
                {name:{equals:req.body.categoryName,mode:"insensitive"}},
                {slug:String(req.body.categoryName).toUpperCase()}
            ]
        };

        if(cuisine?.id){
            categoryWhere.cuisineId = cuisine.id;
        }

        category = await prisma.categories.findFirst({
            where:categoryWhere
        });

        if(!category){
            throw new apiError(404,cuisine?.id ? "category not found for selected cuisine" : "category not found");
        }
    }

    const dataToUpdate = {};

    if(req.body.shopId !== undefined) dataToUpdate.shopId = req.body.shopId;
    if(req.body.name !== undefined) dataToUpdate.name = req.body.name;
    if(req.body.description !== undefined) dataToUpdate.description = req.body.description;
    if(req.body.imageUrl !== undefined) dataToUpdate.imageUrl = req.body.imageUrl;
    if(req.body.active !== undefined) dataToUpdate.active = req.body.active;
    if(req.body.availableQuantity !== undefined) dataToUpdate.availableQuantity = Number(req.body.availableQuantity);
    if(req.body.sortOrderId !== undefined) dataToUpdate.sortOrderId = Number(req.body.sortOrderId);

    if(cuisine || req.body.cuisineId === null) dataToUpdate.cuisineId = cuisine?.id || null;
    if(category || req.body.categoryId === null) dataToUpdate.categoryId = category?.id || null;

    if(req.body.items !== undefined || req.body.itemIds !== undefined){
        const selectedItems = Array.isArray(req.body.items) && req.body.items.length > 0 ? req.body.items : req.body.itemIds;

        if(!Array.isArray(selectedItems) || selectedItems.length === 0){
            throw new apiError(400,"combo items are required");
        }

        const normalizedItems = selectedItems.map((item)=>{
            if(typeof item === "string"){
                return {
                    itemId:item,
                    quantity:1
                };
            }

            return {
                itemId:item.itemId || item.id,
                quantity:Number(item.quantity ?? 1)
            };
        });

        if(normalizedItems.some((item)=>!item.itemId)){
            throw new apiError(400,"each combo item needs an itemId");
        }

        if(normalizedItems.some((item)=>!Number.isFinite(item.quantity) || item.quantity < 1)){
            throw new apiError(400,"combo item quantity must be at least 1");
        }

        const uniqueItemIds = [...new Set(normalizedItems.map((item)=>String(item.itemId)))];
        if(uniqueItemIds.length !== normalizedItems.length){
            throw new apiError(400,"duplicate combo items are not allowed");
        }

        const activeCategoryId = dataToUpdate.categoryId === null ? undefined : dataToUpdate.categoryId || existingCombo.categoryId;
        const activeCuisineId = dataToUpdate.cuisineId === null ? undefined : dataToUpdate.cuisineId || existingCombo.cuisineId;

        const comboItemsData = await prisma.shopItem.findMany({
            where:{
                id:{
                    in:uniqueItemIds
                },
                active:true,
                shopId:targetShopId
            },
            select:{
                id:true,
                pricing:true,
                variantGroups:{
                    where:{active:true},
                    orderBy:{sortOrder:"asc"},
                    select:shopItemVariantSelect
                }
            }
        });

        if(comboItemsData.length !== uniqueItemIds.length){
            throw new apiError(404,"one or more selected items were not found for this shop");
        }
        const shopItemsById = new Map(comboItemsData.map((item)=>[item.id,item]));
        const comboItems = normalizedItems.map((selectedItem)=>{
            const item = shopItemsById.get(String(selectedItem.itemId));

            return {
                item,
                quantity:selectedItem.quantity
            };
        });

        const activeComboName = dataToUpdate.name || existingCombo.name;
        const activeShopId = dataToUpdate.shopId || existingCombo.shopId;
        const comboItemKey = comboItems
            .map((comboItem)=>`${comboItem.item.id}:${comboItem.quantity}`)
            .sort()
            .join("|");
        const comboKey = [
            activeComboName.trim().toLowerCase(),
            activeCuisineId || "no-cuisine",
            activeCategoryId || "no-category",
            comboItemKey
        ].join("::");

        const comboTotalPrice = Math.round(comboItems.reduce((sum,comboItem)=>{
            const itemPrice = calculateShopItemLowestPrice(comboItem.item);
            return sum + itemPrice * comboItem.quantity;
        },0));

        if(!Number.isFinite(comboTotalPrice) || comboTotalPrice < 0){
            throw new apiError(400,"totalPrice must be a valid number");
        }

        if(comboItems.some((comboItem)=>{
            const itemPrice = calculateShopItemLowestPrice(comboItem.item);
            return !Number.isFinite(itemPrice) || itemPrice < 0;
        })){
            throw new apiError(400,"selected item pricing must be valid non-negative numbers");
        }

        dataToUpdate.comboKey = comboKey;
        dataToUpdate.totalPrice = comboTotalPrice;
        dataToUpdate.items = {
            deleteMany:{},
            create:comboItems.map((comboItem)=>({
                itemId:comboItem.item.id,
                quantity:comboItem.quantity
            }))
        };
    }else{
        const shouldRebuildComboKey = dataToUpdate.name !== undefined ||
            dataToUpdate.shopId !== undefined ||
            Object.prototype.hasOwnProperty.call(dataToUpdate,"cuisineId") ||
            Object.prototype.hasOwnProperty.call(dataToUpdate,"categoryId");

        if(shouldRebuildComboKey){
            const existingComboItems = await prisma.comboItem.findMany({
                where:{
                    comboId
                },
                select:{
                    itemId:true,
                    quantity:true
                }
            });

            const activeComboName = dataToUpdate.name || existingCombo.name;
            const activeShopId = dataToUpdate.shopId || existingCombo.shopId;
            if(dataToUpdate.shopId !== undefined){
                const existingItemIds = existingComboItems.map((comboItem)=>comboItem.itemId);
                const shopItemCount = await prisma.shopItem.count({
                    where:{
                        id:{
                            in:existingItemIds
                        },
                        active:true,
                        shopId:activeShopId
                    }
                });

                if(shopItemCount !== existingItemIds.length){
                    throw new apiError(404,"one or more existing combo items were not found for this shop");
                }
            }

            const activeCuisineId = dataToUpdate.cuisineId === null ? undefined : dataToUpdate.cuisineId || existingCombo.cuisineId;
            const activeCategoryId = dataToUpdate.categoryId === null ? undefined : dataToUpdate.categoryId || existingCombo.categoryId;
            const comboItemKey = existingComboItems
                .map((comboItem)=>`${comboItem.itemId}:${comboItem.quantity}`)
                .sort()
                .join("|");
            const comboKey = [
                activeComboName.trim().toLowerCase(),
                activeCuisineId || "no-cuisine",
                activeCategoryId || "no-category",
                comboItemKey
            ].join("::");

            dataToUpdate.comboKey = comboKey;
        }
    }

    if(Object.keys(dataToUpdate).length === 0){
        throw new apiError(400,"no combo data passed");
    }

    let updatedCombo;
    try{
        updatedCombo = await prisma.combo.update({
            where:{id:comboId},
            data:dataToUpdate,
            select:comboMutationSelect
        });
    }catch(error){
        if(error?.code === "P2002") throw new apiError(409,"same combo already exists for this shop");
        throw error;
    }

    await Promise.all([
        deleteCacheByPattern(`catalog:shop:${existingCombo.shopId}:combos:*`),
        targetShopId !== existingCombo.shopId
            ? deleteCacheByPattern(`catalog:shop:${targetShopId}:combos:*`)
            : Promise.resolve()
    ]);
    return res.status(200).json(new apiResponse(200,updatedCombo,"combo updated successfully"));
});

const deleteCombo = asyncHandler(async(req,res)=>{
    const {comboId} = req.params;

    if(!comboId) throw new apiError(400,"combo id is required");

    const [combo,currentUser] = await Promise.all([
        prisma.combo.findUnique({
            where:{id:comboId},
            select:{id:true,shopId:true}
        }),
        prisma.user.findUnique({
            where:{id:req.userData?.id},
            select:{id:true,role:true,isBlocked:true}
        })
    ]);

    if(!combo) throw new apiError(404,"combo not found");

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{
            id:combo.shopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage combos for your own shop");
    }

    const deletedCombo = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.combo.delete({
            where:{id:comboId},
            select:{id:true,shopId:true}
        });
        await releaseShopSlot(tx,shop.id);
        return deleted;
    });

    await deleteCacheByPattern(`catalog:shop:${shop.id}:combos:*`);
    return res.status(200).json(new apiResponse(200,deletedCombo,"combo deleted successfully"));
});

const getCombosByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const pagination = getPagination(req.query);

    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await getOrSetCachedData(`catalog:shop:${shopId}:combos:meta`,()=>{
        return prisma.shop.findUnique({
            where:{id:shopId},
            select:{
                id:true,
                shopName:true,
                shopType:{
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        features:{
                            where:{enabled:true},
                            select:{feature:true}
                        }
                    }
                },
                featureOverrides:{
                    select:{feature:true,enabled:true}
                }
            }
        });
    },45);

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"COMBOS")){
        throw new apiError(403,"combos are not enabled for this shop type");
    }

    const where = {
        shopId
    };

    const cacheKey = `catalog:shop:${shopId}:combos:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [combos,total] = await Promise.all([
            prisma.combo.findMany({
                where,
                orderBy:[
                    {
                        sortOrderId:"asc"
                    },
                    {
                        createdAt:"desc"
                    }
                ],
                skip:pagination.skip,
                take:pagination.take,
                select:comboListSelect
            }),
            prisma.combo.count({ where })
        ]);

        return {
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug,
                    features:shop.shopType.features.map((feature)=>feature.feature)
                } : null
            },
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total
            }),
            combos:combos.map(formatComboListItem)
        };
    },45);

    return res.status(200).json(new apiResponse(200,responseData,"shop combos fetched successfully"));
});

const fetchCombosByClassification = asyncHandler(async(req,res)=>{
    const {
        shopId,
        cuisineId,
        cuisineName,
        categoryId,
        categoryName
    } = req.query;
    const pagination = getPagination(req.query);

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!cuisineId && !cuisineName && !categoryId && !categoryName){
        throw new apiError(400,"cuisine or category filter is required");
    }

    const cuisineLookup = cuisineId || (cuisineName ? String(cuisineName).trim().toLowerCase() : null);
    const [shop,cuisine] = await Promise.all([
        getOrSetCachedData(`catalog:shop:${shopId}:combos:classification:meta`,()=>{
            return prisma.shop.findUnique({
                where:{id:shopId},
                select:{id:true,shopName:true}
            });
        },45),
        cuisineLookup
            ? getOrSetCachedData(`catalog:cuisines:lookup:${cuisineLookup}`,()=>{
                return prisma.cuisine.findFirst({
                    where:cuisineId ? {id:cuisineId} : {
                        OR:[
                            {name:{equals:cuisineName,mode:"insensitive"}},
                            {slug:String(cuisineName).toUpperCase()}
                        ]
                    }
                });
            },120)
            : Promise.resolve(null)
    ]);

    if(!shop) throw new apiError(404,"shop not found");
    if(cuisineLookup && !cuisine) throw new apiError(404,"cuisine not found");

    let category = null;
    if(categoryId || categoryName){
        const categoryWhere = categoryId ? {
            id:categoryId
        } : {
            OR:[
                {name:{equals:categoryName,mode:"insensitive"}},
                {slug:String(categoryName).toUpperCase()}
            ]
        };

        if(cuisine?.id){
            categoryWhere.cuisineId = cuisine.id;
        }

        const categoryLookup = categoryId || String(categoryName).trim().toLowerCase();
        category = await getOrSetCachedData(`catalog:categories:lookup:${categoryLookup}:${cuisine?.id || "all"}`,()=>{
            return prisma.categories.findFirst({where:categoryWhere});
        },120);

        if(!category){
            throw new apiError(404,cuisine?.id ? "category not found for selected cuisine" : "category not found");
        }
    }

    const where = {
        shopId,
        active:true,
        ...(cuisine?.id ? {
            cuisineId:cuisine.id
        } : {}),
        ...(category?.id ? {
            categoryId:category.id
        } : {})
    };

    const cacheKey = `catalog:shop:${shopId}:combos:classification:${cuisine?.id || "all-cuisines"}:${category?.id || "all-categories"}:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [combos,total] = await Promise.all([
            prisma.combo.findMany({
                where,
                orderBy:[
                    {
                        sortOrderId:"asc"
                    },
                    {
                        createdAt:"desc"
                    }
                ],
                skip:pagination.skip,
                take:pagination.take,
                select:comboListSelect
            }),
            prisma.combo.count({ where })
        ]);

        return {
            shop,
            selected:{
                cuisine,
                category
            },
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total
            }),
            combos:combos.map(formatComboListItem)
        };
    },45);

    return res.status(200).json(new apiResponse(200,responseData,"filtered combos fetched successfully"));
});

const comboBuilder = asyncHandler(async(req,res)=>{
    const {
        shopId,
        cuisineId,
        cuisineName,
        categoryId,
        categoryName
    } = req.query;

    if(!shopId) throw new apiError(400,"shop id is required");

    const [currentUser,shop] = await Promise.all([
        prisma.user.findUnique({
            where:{id:req.userData?.id},
            select:{id:true,role:true,isBlocked:true}
        }),
        prisma.shop.findUnique({
            where:{id:shopId},
            select:{id:true,shopName:true,ownerId:true}
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only build combos for your own shop");
    }

    let cuisine = null;
    if(cuisineId || cuisineName){
        cuisine = await prisma.cuisine.findFirst({
            where:cuisineId ? {
                id:cuisineId
            } : {
                OR:[
                    {name:{equals:cuisineName,mode:"insensitive"}},
                    {slug:String(cuisineName).toUpperCase()}
                ]
            }
        });

        if(!cuisine) throw new apiError(404,"cuisine not found");
    }

    let category = null;
    if(categoryId || categoryName){
        const categoryWhere = categoryId ? {
            id:categoryId
        } : {
            OR:[
                {name:{equals:categoryName,mode:"insensitive"}},
                {slug:String(categoryName).toUpperCase()}
            ]
        };

        if(cuisine?.id){
            categoryWhere.cuisineId = cuisine.id;
        }

        category = await prisma.categories.findFirst({
            where:categoryWhere
        });

        if(!category){
            throw new apiError(404,cuisine?.id ? "category not found for selected cuisine" : "category not found");
        }
    }

    const [categories,items] = await Promise.all([
        prisma.categories.findMany({
            where:{
                active:true,
                ...(cuisine?.id ? {cuisineId:cuisine.id} : {})
            },
            orderBy:{sortOrderId:"asc"},
            select:{id:true,name:true,slug:true,cuisineId:true,sortOrderId:true}
        }),
        prisma.shopItem.findMany({
        where:{
            active:true,
            shopId,
            ...(category?.id ? {
                item:{
                    categoryId:category.id
                }
            } : {}),
            ...(cuisine?.id && !category?.id ? {
                item:{
                    category:{
                        is:{
                            cuisineId:cuisine.id
                        }
                    }
                }
            } : {})
        },
        orderBy:{
            sortOrderId:"asc"
        },
        select:{
            id:true,
            pricing:true,
            availableQuantity:true,
            imageUrl:true,
            description:true,
            sortOrderId:true,
            variantGroups:{
                orderBy:{sortOrder:"asc"},
                select:shopItemVariantSelect
            },
            item:{
                select:{
                    id:true,
                    name:true,
                    imageUrl:true,
                    categoryId:true,
                    category:{
                        select:{
                            id:true,
                            name:true,
                            slug:true,
                            cuisineId:true
                        }
                    }
                }
            }
        }
        })
    ]);

    return res.status(200).json(new apiResponse(200,{
        selected:{
            shop,
            cuisine,
            category
        },
        categories,
        items:items.map((item)=>({
            ...item,
            ...formatShopItemPricing(item),
            lowestPrice:calculateShopItemLowestPrice(item),
            hasVariants:hasShopItemVariants(item),
            variantGroups:formatShopItemVariantGroups(item.variantGroups)
        }))
    },"combo builder data fetched successfully"));
});

export { createCombo, editCombo, deleteCombo, getCombosByShop, fetchCombosByClassification, comboBuilder };
