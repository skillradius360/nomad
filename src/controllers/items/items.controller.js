import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";

const masterItemInclude = {
    category:{
        select:{
            id:true,
            name:true,
            slug:true,
            cuisine:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    },
    tags:{
        include:{
            tag:true
        }
    }
};

const shopItemInclude = {
    shop:{
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    },
    item:{
        include:masterItemInclude
    }
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

    return res.status(200).json(new apiResponse(200,updatedCategoryData,"mapping of category and item updated successfully"));
});

const fetchItemsToCategory = asyncHandler(async(req,res)=>{
    const categoryName = req.params.categoryName || req.query.categoryName || req.body.categoryName;

    if(!categoryName) throw new apiError(400,"category name is required");

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

    return res.status(200).json(new apiResponse(200,categoryData.allItems,"items fetched successfully"));
});

const fetchAllItems = asyncHandler(async(req,res)=>{
    const items = await prisma.items.findMany({
        orderBy:{
            sortOrderId:"asc"
        },
        include:masterItemInclude
    });

    return res.status(200).json(new apiResponse(200,items,"master items fetched successfully"));
});

const fetchOnlyItems = asyncHandler(async(req,res)=>{
    const items = await prisma.items.findMany({
        orderBy:{
            sortOrderId:"asc"
        }
    });

    return res.status(200).json(new apiResponse(200,items,"master items fetched successfully"));
});

const fetchItemsByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const {categoryId,categoryName,cuisineId,cuisineName} = req.query;

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
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only fetch items for your own shop");
    }

    const cuisine = await resolveCuisine({cuisineId,cuisineName});
    const category = await resolveCategory({categoryId,categoryName,cuisineId,cuisineName});

    const items = await prisma.shopItem.findMany({
        where:{
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
        },
        orderBy:{
            sortOrderId:"asc"
        },
        include:shopItemInclude
    });

    return res.status(200).json(new apiResponse(200,{
        shop,
        selected:{
            cuisine,
            category
        },
        items
    },"shop items fetched successfully"));
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

    return res.status(200).json(new apiResponse(200,updatedShopItems,"shop items reordered successfully"));
});

const editShopItem = asyncHandler(async(req,res)=>{
    const {shopItemId} = req.params;
    const {
        pricing,
        discount,
        discountPercentage,
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

    if(discount !== undefined && discount !== null){
        const updatedDiscount = Number(discount);
        if(!Number.isFinite(updatedDiscount) || updatedDiscount < 0){
            throw new apiError(400,"discount must be a valid non-negative number");
        }
    }

    if(discountPercentage !== undefined && discountPercentage !== null){
        const updatedDiscountPercentage = Number(discountPercentage);
        if(!Number.isFinite(updatedDiscountPercentage) || updatedDiscountPercentage < 0){
            throw new apiError(400,"discountPercentage must be a valid non-negative number");
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
    if(discount !== undefined) dataToUpdate.discount = discount === null ? null : Number(discount);
    if(discountPercentage !== undefined) dataToUpdate.discountPercentage = discountPercentage === null ? null : Number(discountPercentage);
    if(availableQuantity !== undefined) dataToUpdate.availableQuantity = availableQuantity === null ? null : Number(availableQuantity);
    if(description !== undefined) dataToUpdate.description = description;
    if(uploadedImageUrl || imageUrl !== undefined || photoUrl !== undefined) dataToUpdate.imageUrl = uploadedImageUrl || imageUrl || photoUrl;
    if(sortOrderId !== undefined || sortOrder !== undefined) dataToUpdate.sortOrderId = sortOrderId === null || sortOrder === null ? null : Number(sortOrderId ?? sortOrder);
    if(active !== undefined) dataToUpdate.active = active;

    if(Object.keys(dataToUpdate).length === 0) throw new apiError(400,"no shop item data passed");

    const updatedShopItem = await prisma.shopItem.update({
        where:{
            id:shopItemId
        },
        data:dataToUpdate,
        include:shopItemInclude
    });

    if(pricing !== undefined || discount !== undefined || discountPercentage !== undefined){
        const affectedCombos = await prisma.combo.findMany({
            where:{
                shopId:updatedShopItem.shopId,
                items:{
                    some:{
                        itemId:updatedShopItem.id
                    }
                }
            },
            include:{
                items:{
                    include:{
                        item:true
                    }
                }
            }
        });

        for(const combo of affectedCombos){
            const recalculatedTotalPrice = combo.items.reduce((sum,comboItem)=>{
                const itemPrice = Number(comboItem.item.pricing);
                const itemDiscount = Number(comboItem.item.discount ?? 0);
                const itemPercentageDiscount = Number(comboItem.item.discountPercentage ?? 0);
                const itemFinalPrice = Math.max(0,Math.round(itemPrice - itemDiscount - (itemPrice * itemPercentageDiscount / 100)));
                return sum + itemFinalPrice * comboItem.quantity;
            },0);
            const recalculatedFinalPrice = Math.max(0,Math.round(recalculatedTotalPrice - Number(combo.discount ?? 0) - (recalculatedTotalPrice * Number(combo.percentageDiscount ?? 0) / 100)));

            await prisma.combo.update({
                where:{
                    id:combo.id
                },
                data:{
                    totalPrice:recalculatedTotalPrice,
                    finalPrice:recalculatedFinalPrice
                }
            });
        }
    }

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

    const deletedShopItem = await prisma.shopItem.delete({
        where:{
            id:shopItemId
        }
    });

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
    if(active !== undefined) dataToUpdate.active = active;

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

    return res.status(200).json(new apiResponse(200,updatedItem,"master item updated successfully"));
});

// admin: delete a master catalog item
const deleteItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;

    if(!itemId) throw new apiError(400,"item id is required");

    const deletedItem = await prisma.items.delete({
        where:{
            id:itemId
        }
    });

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
        discount,
        discountPercentage,
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
    const shopItemDiscount = Number(discount ?? 0);
    const shopItemDiscountPercentage = Number(discountPercentage ?? 0);
    const shopItemAvailableQuantity = Number(availableQuantity ?? 0);

    if(!Number.isFinite(shopItemPrice) || shopItemPrice < 0){
        throw new apiError(400,"pricing must be a valid non-negative number");
    }

    if(!Number.isFinite(shopItemDiscount) || shopItemDiscount < 0 || !Number.isFinite(shopItemDiscountPercentage) || shopItemDiscountPercentage < 0){
        throw new apiError(400,"discount values must be valid non-negative numbers");
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
            shopName:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(shop.ownerId !== sellerId) throw new apiError(403,"You can only create products for your own shop");

    const itemImg = req.files?.itemImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(itemImg){
        const imgUrl = await cloudUploader(itemImg);
        if(!imgUrl?.url) throw new apiError(400,"image upload failure")
        uploadedImageUrl = imgUrl.url;
    }
    const requestedImageUrl = uploadedImageUrl || imageUrl || photoUrl;
    const category = await resolveCategory({categoryId,categoryName,cuisineName,cuisineId,required:!masterItemId});

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
                categoryId:category.id
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
                    categoryId:category.id
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

    const shopItem = await prisma.shopItem.create({
        data:{
            shopId,
            itemId:masterItem.id,
            pricing:String(shopItemPrice),
            discount:shopItemDiscount,
            discountPercentage:shopItemDiscountPercentage,
            availableQuantity:shopItemAvailableQuantity,
            description,
            imageUrl:requestedImageUrl,
            sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
            active:active ?? true
        },
        include:shopItemInclude
    });

    return res.status(201).json(new apiResponse(201,shopItem,"item added to shop successfully"));
});

export { createItems, mapItems, fetchItemsToCategory, fetchAllItems, fetchOnlyItems, fetchItemsByShop, reorderItems, reorderShopItems, editShopItem, deleteShopItem, editItem, deleteItem, addPersonalProduct };
