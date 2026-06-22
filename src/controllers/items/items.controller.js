import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { deleteCacheByPattern, getOrSetCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { shopHasFeature } from "../../utils/shopFeatures.js";
import { releaseShopSlot, reserveShopSlot } from "../../utils/billing.js";

const MASTER_ITEMS_CACHE_TTL = 120;
const SHOP_ITEMS_CACHE_TTL = 45;

const invalidateMasterItemCaches = async({includeShopItems = true} = {})=>{
    const invalidations = [deleteCacheByPattern("catalog:master:items:*")];
    if(includeShopItems){
        invalidations.push(deleteCacheByPattern("catalog:shop:*:items:*"));
    }
    await Promise.all(invalidations);
};

const invalidateShopItemCaches = async(shopId)=>{
    if(!shopId) return;
    await deleteCacheByPattern(`catalog:shop:${shopId}:items:*`);
};

const masterItemInclude = {
    category:{
        select:{
            id:true,
            name:true,
            slug:true,
            cuisineId:true
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
    }
};

const shopItemInclude = {
    item:{
        include:masterItemInclude
    }
};

const shopItemListSelect = {
    id:true,
    itemId:true,
    pricing:true,
    availableQuantity:true,
    imageUrl:true,
    description:true,
    sortOrderId:true,
    active:true,
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
};

const formatShopItemListItem = (shopItem)=>({
    id:shopItem.id,
    itemId:shopItem.itemId,
    name:shopItem.item?.name,
    pricing:shopItem.pricing,
    availableQuantity:shopItem.availableQuantity,
    imageUrl:shopItem.imageUrl || shopItem.item?.imageUrl || null,
    description:shopItem.description,
    sortOrderId:shopItem.sortOrderId,
    active:shopItem.active,
    categoryId:shopItem.item?.categoryId || null,
    categoryName:shopItem.item?.category?.name || null,
    cuisineId:shopItem.item?.category?.cuisineId || null
});

const formatSelectedFilter = (record)=>record ? {
    id:record.id,
    name:record.name
} : null;

const parseBooleanField = (value,fieldName)=>{
    if(value === undefined) return undefined;
    if(typeof value === "boolean") return value;
    if(typeof value === "string"){
        const normalizedValue = value.trim().toLowerCase();
        if(normalizedValue === "true") return true;
        if(normalizedValue === "false") return false;
    }
    throw new apiError(400,`${fieldName} must be a boolean`);
};

const resolveCuisine = async({cuisineId,cuisineName})=>{
    if(!cuisineId && !cuisineName) return null;

    const cuisine = await prisma.cuisine.findFirst({
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
    return cuisine;
};

const resolveCategory = async({categoryId,categoryName,cuisineName,cuisineId,required = false})=>{
    if(!categoryId && !categoryName){
        if(required) throw new apiError(400,"category is required");
        return null;
    }

    const where = categoryId ? {
        id:categoryId
    } : {
        OR:[
            {name:{equals:categoryName,mode:"insensitive"}},
            {slug:String(categoryName).toUpperCase()}
        ]
    };

    if(cuisineId){
        where.cuisineId = cuisineId;
    }

    if(cuisineName){
        where.cuisine = {
            is:{
                OR:[
                    {name:{equals:cuisineName,mode:"insensitive"}},
                    {slug:String(cuisineName).toUpperCase()}
                ]
            }
        };
    }

    const category = await prisma.categories.findFirst({
        where,
        include:{
            cuisine:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    });

    if(!category) throw new apiError(404,cuisineName || cuisineId ? "category not found for selected cuisine" : "category not found");
    return category;
};

// admin: create a master catalog item
const createItems = asyncHandler(async(req,res)=>{
    const {
        name,
        itemName,
        description,
        sortOrderId,
        sortOrder,
        categoryId,
        categoryName,
        cuisineName,
        cuisineId
    } = req.body;
    const itemTitle = itemName || name;

    if(!itemTitle) throw new apiError(400,"item name is required");


    const itemImg = req.files?.itemImg?.[0]?.path;
    if(!itemImg) throw new apiError(400,"image not passed for item creation")

    const imgUrl = await cloudUploader(itemImg);
    if(!imgUrl?.url) throw new apiError(400,"image upload failure")

    const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId});

    const existingItem = await prisma.items.findFirst({
        where:{
            name:{
                equals:itemTitle,
                mode:"insensitive"
            },
            categoryId:category?.id || null
        }
    });

    if(existingItem) throw new apiError(409,"item already exists in master list");

    const itemData = await prisma.items.create({
        data:{
            name:itemTitle,
            description,
            imageUrl:imgUrl.url,
            sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
            categoryId:category?.id
        },
        include:masterItemInclude
    });

    await invalidateMasterItemCaches({includeShopItems:false});
    return res.status(201).json(new apiResponse(201,itemData,"master item created successfully"));
});

// admin: map master items to a category
const mapItems = asyncHandler(async(req,res)=>{
    const {categoryName,cuisineName,menuItems} = req.body;

    if(!categoryName) throw new apiError(400,"category name is required");
    if(!Array.isArray(menuItems) || menuItems.length === 0) throw new apiError(400,"Not a array passed with menu items");

    const requestedItems = menuItems.map((item)=>{
        if(typeof item === "string") return {name:item};
        return {
            id:item.id || item.itemId,
            name:item.name || item.itemName,
            sortOrderId:item.sortOrderId
        };
    });

    const itemWhere = requestedItems
        .map((item)=>{
            const conditions = [];
            if(item.id !== undefined && item.id !== null) conditions.push({id:String(item.id)});
            if(item.name) conditions.push({name:{equals:item.name,mode:"insensitive"}});
            return conditions.length ? {OR:conditions} : null;
        })
        .filter(Boolean);

    if(itemWhere.length !== requestedItems.length) throw new apiError(400,"item id or name is required");

    const categoryData = await resolveCategory({categoryName,cuisineName,required:true});

    const itemsData = await prisma.items.findMany({
        where:{
            OR:itemWhere
        },
        include:masterItemInclude
    });

    const missingItems = requestedItems.filter((requestedItem)=>{
        return !itemsData.some((item)=>{
            return item.id === String(requestedItem.id) ||
                item.name.toLowerCase() === requestedItem.name?.toLowerCase();
        });
    });

    if(missingItems.length > 0){
        const missingNames = missingItems.map((item)=>item.name || item.id);
        throw new apiError(404,`items not found: ${missingNames.join(", ")}`);
    }

    const alreadyAssignedItems = itemsData.filter((item)=>item.categoryId && item.categoryId !== categoryData.id);
    if(alreadyAssignedItems.length > 0){
        const assignedNames = alreadyAssignedItems.map((item)=>`${item.name} is already assigned to ${item.category?.name || "another category"}`);
        throw new apiError(409,assignedNames.join(", "));
    }

    const updatedCategoryData = await prisma.categories.update({
        where:{
            id:categoryData.id
        },
        data:{
            allItems:{
                connect:itemsData.map((item)=>({
                    id:item.id
                }))
            }
        },
        include:{
            allItems:{
                orderBy:{
                    sortOrderId:"asc"
                },
                include:masterItemInclude
            }
        }
    });

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,updatedCategoryData,"mapping of category and item updated successfully"));
});

const fetchItemsToCategory = asyncHandler(async(req,res)=>{
    const categoryName = req.params.categoryName || req.query.categoryName || req.body.categoryName;

    if(!categoryName) throw new apiError(400,"category name is required");

    const cacheKey = `catalog:master:items:category:${String(categoryName).trim().toLowerCase()}`;
    const items = await getOrSetCachedData(cacheKey,async()=>{
        const categoryData = await prisma.categories.findFirst({
            where:{
                OR:[
                    {name:{equals:categoryName,mode:"insensitive"}},
                    {slug:categoryName.toUpperCase()}
                ]
            },
            include:{
                allItems:{
                    orderBy:{
                        sortOrderId:"asc"
                    },
                    include:masterItemInclude
                }
            }
        });

        if(!categoryData) throw new apiError(404,"category not found");
        return categoryData.allItems;
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,items,"items fetched successfully"));
});

const fetchAllItems = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100});
    const cacheKey = `catalog:master:items:all:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
        prisma.items.findMany({
            skip:pagination.skip,
            take:pagination.take,
            orderBy:{
                sortOrderId:"asc"
            },
            select:{
                id:true,
                name:true,
                description:true,
                imageUrl:true,
                sortOrderId:true,
                categoryId:true,
                active:true,
                category:{
                    select:{
                        id:true,
                        name:true,
                        slug:true,
                        cuisineId:true
                    }
                }
            }
        }),
        prisma.items.count()
        ]);

        return {
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        items:items.map((item)=>({
            id:item.id,
            name:item.name,
            description:item.description,
            imageUrl:item.imageUrl,
            sortOrderId:item.sortOrderId,
            active:item.active,
            categoryId:item.categoryId,
            categoryName:item.category?.name || null,
            cuisineId:item.category?.cuisineId || null
        }))
        };
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"master items fetched successfully"));
});

const fetchOnlyItems = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:50,maxLimit:100});
    const cacheKey = `catalog:master:items:only:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
        prisma.items.findMany({
            skip:pagination.skip,
            take:pagination.take,
            orderBy:{
                sortOrderId:"asc"
            },
            select:{
                id:true,
                name:true,
                imageUrl:true,
                sortOrderId:true,
                active:true
            }
        }),
        prisma.items.count()
        ]);

        return {
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        items
        };
    },MASTER_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"master items fetched successfully"));
});

const fetchItemsByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const {categoryId,categoryName,cuisineId,cuisineName} = req.query;
    const pagination = getPagination(req.query);

    if(!shopId) throw new apiError(400,"shop id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true,
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
                select:{
                    feature:true,
                    enabled:true
                }
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"ITEMS")){
        throw new apiError(403,"items are not enabled for this shop type");
    }
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only fetch items for your own shop");
    }

    const cuisine = await resolveCuisine({cuisineId,cuisineName});
    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const where = {
        shopId,
        active:true,
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
    };

    const cacheKey = `catalog:shop:${shopId}:items:${category?.id || "all-categories"}:${cuisine?.id || "all-cuisines"}:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const [items,total] = await Promise.all([
            prisma.shopItem.findMany({
                where,
                orderBy:{
                    sortOrderId:"asc"
                },
                skip:pagination.skip,
                take:pagination.take,
                select:shopItemListSelect
            }),
            prisma.shopItem.count({ where })
        ]);

        return {
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                ownerId:shop.ownerId,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug,
                    features:shop.shopType.features.map((feature)=>feature.feature)
                } : null
            },
            selected:{
                cuisine:formatSelectedFilter(cuisine),
                category:formatSelectedFilter(category)
            },
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total
            }),
            items:items.map(formatShopItemListItem)
        };
    },SHOP_ITEMS_CACHE_TTL);

    return res.status(200).json(new apiResponse(200,responseData,"shop items fetched successfully"));
});

// admin: reorder master catalog items
const reorderItems = asyncHandler(async(req,res)=>{
    const {itemIds,categoryId,categoryName,cuisineId,cuisineName} = req.body;

    if(!Array.isArray(itemIds) || itemIds.length === 0){
        throw new apiError(400,"itemIds must be a non-empty array");
    }

    const uniqueItemIds = [...new Set(itemIds.map((itemId)=>String(itemId)).filter(Boolean))];
    if(uniqueItemIds.length !== itemIds.length){
        throw new apiError(400,"duplicate item ids are not allowed");
    }

    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const items = await prisma.items.findMany({
        where:{
            id:{
                in:uniqueItemIds
            },
            ...(category?.id ? {
                categoryId:category.id
            } : {})
        },
        select:{
            id:true
        }
    });

    if(items.length !== uniqueItemIds.length){
        throw new apiError(400,"one or more item ids are invalid");
    }

    const updatedItems = await prisma.$transaction(
        uniqueItemIds.map((itemId,index)=>{
            return prisma.items.update({
                where:{
                    id:itemId
                },
                data:{
                    sortOrderId:index + 1
                },
                include:masterItemInclude
            });
        })
    );

    await invalidateMasterItemCaches({includeShopItems:false});
    return res.status(200).json(new apiResponse(200,updatedItems,"items reordered successfully"));
});

// admin or seller: reorder items inside a seller shop
const reorderShopItems = asyncHandler(async(req,res)=>{
    const {shopId,shopItemIds,categoryId,categoryName,cuisineId,cuisineName} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!Array.isArray(shopItemIds) || shopItemIds.length === 0){
        throw new apiError(400,"shopItemIds must be a non-empty array");
    }

    const uniqueShopItemIds = [...new Set(shopItemIds.map((shopItemId)=>String(shopItemId)).filter(Boolean))];
    if(uniqueShopItemIds.length !== shopItemIds.length){
        throw new apiError(400,"duplicate shop item ids are not allowed");
    }

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only reorder items for your own shop");
    }

    const cuisine = await resolveCuisine({cuisineId,cuisineName});
    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const shopItems = await prisma.shopItem.findMany({
        where:{
            id:{
                in:uniqueShopItemIds
            },
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
        select:{
            id:true
        }
    });

    if(shopItems.length !== uniqueShopItemIds.length){
        throw new apiError(400,"one or more shop item ids are invalid");
    }

    const updatedShopItems = await prisma.$transaction(
        uniqueShopItemIds.map((shopItemId,index)=>{
            return prisma.shopItem.update({
                where:{
                    id:shopItemId
                },
                data:{
                    sortOrderId:index + 1
                },
                include:shopItemInclude
            });
        })
    );

    await invalidateShopItemCaches(shopId);
    return res.status(200).json(new apiResponse(200,updatedShopItems,"shop items reordered successfully"));
});

const editShopItem = asyncHandler(async(req,res)=>{
    const {shopItemId} = req.params;
    const {
        pricing,
        availableQuantity,
        description,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        active
    } = req.body;

    if(!shopItemId) throw new apiError(400,"shop item id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            id:shopItemId
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

    if(!existingShopItem) throw new apiError(404,"shop item not found");
    if(currentUser.role !== "ADMIN" && existingShopItem.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only edit items for your own shop");
    }

    if(pricing !== undefined && pricing !== null && pricing !== ""){
        const updatedPrice = Number(pricing);
        if(!Number.isFinite(updatedPrice) || updatedPrice < 0){
            throw new apiError(400,"pricing must be a valid non-negative number");
        }
    }

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const dataToUpdate = {};

    if(pricing !== undefined) dataToUpdate.pricing = String(pricing);
    if(availableQuantity !== undefined) dataToUpdate.availableQuantity = availableQuantity === null ? null : Number(availableQuantity);
    if(description !== undefined) dataToUpdate.description = description;
    if(uploadedImageUrl || imageUrl !== undefined || photoUrl !== undefined) dataToUpdate.imageUrl = uploadedImageUrl || imageUrl || photoUrl;
    if(sortOrderId !== undefined || sortOrder !== undefined) dataToUpdate.sortOrderId = sortOrderId === null || sortOrder === null ? null : Number(sortOrderId ?? sortOrder);
    if(active !== undefined) dataToUpdate.active = parseBooleanField(active,"active");

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no shop item data passed");

    const updatedShopItem = await prisma.shopItem.update({
        where:{
            id:shopItemId
        },
        data:dataToUpdate,
        include:shopItemInclude
    });

    if(pricing !== undefined){
        const affectedCombos = await prisma.combo.findMany({
            where:{
                shopId:updatedShopItem.shopId,
                items:{
                    some:{
                        itemId:updatedShopItem.id
                    }
                }
            },
            select:{
                id:true,
                items:{
                    select:{
                        quantity:true,
                        item:{
                            select:{
                                id:true,
                                pricing:true
                            }
                        }
                    }
                }
            }
        });

        const comboUpdates = affectedCombos.map((combo)=>{
            const recalculatedTotalPrice = combo.items.reduce((sum,comboItem)=>{
                const itemPrice = Number(comboItem.item.pricing);
                return sum + itemPrice * comboItem.quantity;
            },0);

            return prisma.combo.update({
                where:{
                    id:combo.id
                },
                data:{
                    totalPrice:recalculatedTotalPrice
                }
            });
        });
        if(comboUpdates.length > 0) await prisma.$transaction(comboUpdates);
    }

    await Promise.all([
        invalidateShopItemCaches(updatedShopItem.shopId),
        pricing !== undefined
            ? deleteCacheByPattern(`catalog:shop:${updatedShopItem.shopId}:combos:*`)
            : Promise.resolve()
    ]);
    return res.status(200).json(new apiResponse(200,updatedShopItem,"shop item updated successfully"));
});

const deleteShopItem = asyncHandler(async(req,res)=>{
    const {shopItemId} = req.params;

    if(!shopItemId) throw new apiError(400,"shop item id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            id:shopItemId
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

    if(!existingShopItem) throw new apiError(404,"shop item not found");
    if(currentUser.role !== "ADMIN" && existingShopItem.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only delete items from your own shop");
    }

    const deletedShopItem = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.shopItem.delete({
            where:{id:shopItemId}
        });
        await releaseShopSlot(tx,existingShopItem.shop.id);
        return deleted;
    });

    await invalidateShopItemCaches(existingShopItem.shop.id);
    return res.status(200).json(new apiResponse(200,deletedShopItem,"shop item deleted successfully"));
});

// admin: edit a master catalog item
const editItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;
    const {
        itemName,
        name,
        description,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        categoryId,
        categoryName,
        cuisineName,
        cuisineId,
        active
    } = req.body;

    if(!itemId) throw new apiError(400,"item id is required");

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const dataToUpdate = {};
    const updatedName = itemName || name;

    if(updatedName) dataToUpdate.name = updatedName;
    if(description !== undefined) dataToUpdate.description = description;
    if(uploadedImageUrl || imageUrl !== undefined || photoUrl !== undefined) dataToUpdate.imageUrl = uploadedImageUrl || imageUrl || photoUrl;
    if(sortOrderId !== undefined || sortOrder !== undefined) dataToUpdate.sortOrderId = Number(sortOrderId ?? sortOrder);
    if(active !== undefined) dataToUpdate.active = parseBooleanField(active,"active");

    if(categoryId !== undefined || categoryName !== undefined){
        const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId,required:true});
        dataToUpdate.categoryId = category.id;
    }

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no item data passed");

    const updatedItem = await prisma.items.update({
        where:{
            id:itemId
        },
        data:dataToUpdate,
        include:masterItemInclude
    });

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,updatedItem,"master item updated successfully"));
});

// admin: delete a master catalog item
const deleteItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;

    if(!itemId) throw new apiError(400,"item id is required");

    const affectedShopItems = await prisma.shopItem.groupBy({
        by:["shopId"],
        where:{itemId},
        _count:{_all:true}
    });

    const deletedItem = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.items.delete({where:{id:itemId}});
        for(const affectedShop of affectedShopItems){
            await releaseShopSlot(tx,affectedShop.shopId,affectedShop._count._all);
        }
        return deleted;
    });

    await invalidateMasterItemCaches();
    return res.status(200).json(new apiResponse(200,deletedItem,"master item deleted successfully"));
});

// seller: create/reuse a master item and add it to the seller's shop
const addPersonalProduct = asyncHandler(async(req,res)=>{
    const sellerId = req.userData?.id;
    const {
        shopId,
        itemId,
        globalItemId,
        cuisineName,
        cuisineId,
        categoryName,
        categoryId,
        itemName,
        name,
        pricing,
        availableQuantity,
        description,
        imageUrl,
        photoUrl,
        sortOrderId,
        sortOrder,
        active
    } = req.body;
    const customItemName = itemName || name;
    const masterItemId = globalItemId || itemId;

    if(!sellerId) throw new apiError(401,"Unauthorized user");
    if(!shopId) throw new apiError(400,"shop id is required");
    if(!masterItemId && !customItemName) throw new apiError(400,"item id or item name is required");
    if(pricing === undefined || pricing === null || pricing === "") throw new apiError(400,"pricing is required");

    const shopItemPrice = Number(pricing);
    const shopItemAvailableQuantity = Number(availableQuantity ?? 0);

    if(!Number.isFinite(shopItemPrice) || shopItemPrice < 0){
        throw new apiError(400,"pricing must be a valid non-negative number");
    }

    if(!Number.isFinite(shopItemAvailableQuantity) || shopItemAvailableQuantity < 0){
        throw new apiError(400,"availableQuantity must be a valid non-negative number");
    }

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopName:true,
            shopType:{
                select:{
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"ITEMS")){
        throw new apiError(403,"items are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CATEGORIES") && (categoryId || categoryName)){
        throw new apiError(403,"categories are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"CUISINE") && (cuisineId || cuisineName)){
        throw new apiError(403,"cuisine is not enabled for this shop type");
    }
    if(shop.ownerId !== sellerId) throw new apiError(403,"You can only create products for your own shop");

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const requestedImageUrl = uploadedImageUrl || imageUrl || photoUrl;
    const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId,required:!masterItemId && shopHasFeature(shop,"CATEGORIES")});

    let masterItem = null;
    if(masterItemId){
        masterItem = await prisma.items.findUnique({
            where:{
                id:masterItemId
            },
            include:masterItemInclude
        });

        if(!masterItem) throw new apiError(404,"master item not found");
    }else{
        masterItem = await prisma.items.findFirst({
            where:{
                name:{
                    equals:customItemName,
                    mode:"insensitive"
                },
                categoryId:category?.id || null
            },
            include:masterItemInclude
        });

        if(!masterItem){
            masterItem = await prisma.items.create({
                data:{
                    name:customItemName,
                    description,
                    imageUrl:requestedImageUrl,
                    sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
                    categoryId:category?.id
                },
                include:masterItemInclude
            });
        }
    }

    const existingShopItem = await prisma.shopItem.findUnique({
        where:{
            shopId_itemId:{
                shopId,
                itemId:masterItem.id
            }
        }
    });

    if(existingShopItem) throw new apiError(409,`${masterItem.name} is already added to this shop`);

    const shopItem = await prisma.$transaction(async(tx)=>{
        await reserveShopSlot(tx,shopId);
        return tx.shopItem.create({
            data:{
                shopId,
                itemId:masterItem.id,
                pricing:String(shopItemPrice),
                availableQuantity:shopItemAvailableQuantity,
                description,
                imageUrl:requestedImageUrl,
                sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
                active:parseBooleanField(active,"active") ?? true
            },
            include:shopItemInclude
        });
    });

    await Promise.all([
        invalidateMasterItemCaches({includeShopItems:false}),
        invalidateShopItemCaches(shopId)
    ]);
    return res.status(201).json(new apiResponse(201,shopItem,"item added to shop successfully"));
});

export { createItems, mapItems, fetchItemsToCategory, fetchAllItems, fetchOnlyItems, fetchItemsByShop, reorderItems, reorderShopItems, editShopItem, deleteShopItem, editItem, deleteItem, addPersonalProduct };
