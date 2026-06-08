import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const comboInclude = {
    shop:{
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    },
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
        include:{
            tag:true
        }
    },
    items:{
        include:{
            item:{
                include:{
                    shop:{
                        select:{
                            id:true,
                            shopName:true,
                            ownerId:true
                        }
                    },
                    item:{
                        include:{
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
                            }
                        }
                    }
                }
            }
        }
    }
};

const createCombo = asyncHandler(async(req,res)=>{
    const {
        shopId,
        name,
        description,
        imageUrl,
        totalPrice,
        discount,
        percentageDiscount,
        finalPrice,
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
        throw new apiError(403,"You can only manage combos for your own shop");
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

    const selectedItems = Array.isArray(items) && items.length > 0 ? items : itemIds;

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

    const comboItemsData = await prisma.shopItem.findMany({
        where:{
            id:{
                in:uniqueItemIds
            },
            active:true,
            shopId
        }
    });

    if(comboItemsData.length !== uniqueItemIds.length){
        throw new apiError(404,"one or more selected items were not found for this shop");
    }

    const comboItems = normalizedItems.map((selectedItem)=>{
        const item = comboItemsData.find((currentItem)=>currentItem.id === String(selectedItem.itemId));

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

    const existingSameCombo = await prisma.combo.findFirst({
        where:{
            shopId,
            comboKey
        }
    });

    if(existingSameCombo){
        throw new apiError(409,"same combo already exists for this shop");
    }

    const existingCombosWithSameBase = await prisma.combo.findMany({
        where:{
            shopId,
            name:{
                equals:name,
                mode:"insensitive"
            },
            cuisineId:cuisine?.id || null,
            categoryId:category?.id || null
        },
        include:{
            items:{
                select:{
                    itemId:true,
                    quantity:true
                }
            }
        }
    });

    const duplicateCombo = existingCombosWithSameBase.find((existingCombo)=>{
        const existingItemKey = existingCombo.items
            .map((comboItem)=>`${comboItem.itemId}:${comboItem.quantity}`)
            .sort()
            .join("|");

        return existingItemKey === comboItemKey;
    });

    if(duplicateCombo){
        throw new apiError(409,"same combo already exists for this shop");
    }

    const calculatedTotalPrice = comboItems.reduce((sum,comboItem)=>{
        const itemPrice = Number(comboItem.item.pricing);
        const itemDiscount = Number(comboItem.item.discount ?? 0);
        const itemPercentageDiscount = Number(comboItem.item.discountPercentage ?? 0);
        const itemFinalPrice = Math.max(0,Math.round(itemPrice - itemDiscount - (itemPrice * itemPercentageDiscount / 100)));
        return sum + itemFinalPrice * comboItem.quantity;
    },0);

    const comboTotalPrice = totalPrice === undefined || totalPrice === null || totalPrice === ""
        ? Math.round(calculatedTotalPrice)
        : Number(totalPrice);
    const comboDiscount = Number(discount ?? 0);
    const comboPercentageDiscount = Number(percentageDiscount ?? 0);
    const comboFinalPrice = finalPrice === undefined || finalPrice === null || finalPrice === ""
        ? Math.max(0,Math.round(comboTotalPrice - comboDiscount - (comboTotalPrice * comboPercentageDiscount / 100)))
        : Number(finalPrice);

    if(!Number.isFinite(comboTotalPrice) || comboTotalPrice < 0){
        throw new apiError(400,"totalPrice must be a valid number");
    }

    if(!Number.isFinite(comboDiscount) || !Number.isFinite(comboPercentageDiscount) || !Number.isFinite(comboFinalPrice)){
        throw new apiError(400,"combo pricing must be valid numbers");
    }

    if(comboDiscount < 0 || comboPercentageDiscount < 0 || comboFinalPrice < 0){
        throw new apiError(400,"combo pricing cannot be negative");
    }

    if(comboItems.some((comboItem)=>{
        const itemPrice = Number(comboItem.item.pricing);
        const itemDiscount = Number(comboItem.item.discount ?? 0);
        const itemPercentageDiscount = Number(comboItem.item.discountPercentage ?? 0);
        return !Number.isFinite(itemPrice) || itemPrice < 0 || !Number.isFinite(itemDiscount) || itemDiscount < 0 || !Number.isFinite(itemPercentageDiscount) || itemPercentageDiscount < 0;
    })){
        throw new apiError(400,"selected item pricing must be valid non-negative numbers");
    }

    const combo = await prisma.combo.create({
        data:{
            shopId,
            name,
            comboKey,
            description,
            imageUrl,
            totalPrice:comboTotalPrice,
            discount:comboDiscount,
            percentageDiscount:comboPercentageDiscount,
            finalPrice:comboFinalPrice,
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
        include:comboInclude
    });

    return res.status(201).json(new apiResponse(201,combo,"combo created successfully"));
});

const editCombo = asyncHandler(async(req,res)=>{
    const {comboId} = req.params;

    if(!comboId) throw new apiError(400,"combo id is required");

    const existingCombo = await prisma.combo.findUnique({
        where:{
            id:comboId
        },
        select:{
            id:true,
            shopId:true,
            name:true,
            cuisineId:true,
            categoryId:true,
            totalPrice:true,
            discount:true,
            percentageDiscount:true,
            finalPrice:true
        }
    });

    if(!existingCombo) throw new apiError(404,"combo not found");

    const targetShopId = req.body.shopId || existingCombo.shopId;
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
            }
        });

        if(comboItemsData.length !== uniqueItemIds.length){
            throw new apiError(404,"one or more selected items were not found for this shop");
        }

        const comboItems = normalizedItems.map((selectedItem)=>{
            const item = comboItemsData.find((currentItem)=>currentItem.id === String(selectedItem.itemId));

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

        const existingSameCombo = await prisma.combo.findFirst({
            where:{
                shopId:activeShopId,
                comboKey,
                id:{
                    not:comboId
                }
            }
        });

        if(existingSameCombo){
            throw new apiError(409,"same combo already exists for this shop");
        }

        const existingCombosWithSameBase = await prisma.combo.findMany({
            where:{
                shopId:activeShopId,
                id:{
                    not:comboId
                },
                name:{
                    equals:activeComboName,
                    mode:"insensitive"
                },
                cuisineId:activeCuisineId || null,
                categoryId:activeCategoryId || null
            },
            include:{
                items:{
                    select:{
                        itemId:true,
                        quantity:true
                    }
                }
            }
        });

        const duplicateCombo = existingCombosWithSameBase.find((existingCombo)=>{
            const existingItemKey = existingCombo.items
                .map((comboItem)=>`${comboItem.itemId}:${comboItem.quantity}`)
                .sort()
                .join("|");

            return existingItemKey === comboItemKey;
        });

        if(duplicateCombo){
            throw new apiError(409,"same combo already exists for this shop");
        }

        const calculatedTotalPrice = comboItems.reduce((sum,comboItem)=>{
            const itemPrice = Number(comboItem.item.pricing);
            const itemDiscount = Number(comboItem.item.discount ?? 0);
            const itemPercentageDiscount = Number(comboItem.item.discountPercentage ?? 0);
            const itemFinalPrice = Math.max(0,Math.round(itemPrice - itemDiscount - (itemPrice * itemPercentageDiscount / 100)));
            return sum + itemFinalPrice * comboItem.quantity;
        },0);

        const comboTotalPrice = req.body.totalPrice === undefined || req.body.totalPrice === null || req.body.totalPrice === ""
            ? Math.round(calculatedTotalPrice)
            : Number(req.body.totalPrice);
        const comboDiscount = Number(req.body.discount ?? 0);
        const comboPercentageDiscount = Number(req.body.percentageDiscount ?? 0);
        const comboFinalPrice = req.body.finalPrice === undefined || req.body.finalPrice === null || req.body.finalPrice === ""
            ? Math.max(0,Math.round(comboTotalPrice - comboDiscount - (comboTotalPrice * comboPercentageDiscount / 100)))
            : Number(req.body.finalPrice);

        if(!Number.isFinite(comboTotalPrice) || comboTotalPrice < 0){
            throw new apiError(400,"totalPrice must be a valid number");
        }

        if(!Number.isFinite(comboDiscount) || !Number.isFinite(comboPercentageDiscount) || !Number.isFinite(comboFinalPrice)){
            throw new apiError(400,"combo pricing must be valid numbers");
        }

        if(comboDiscount < 0 || comboPercentageDiscount < 0 || comboFinalPrice < 0){
            throw new apiError(400,"combo pricing cannot be negative");
        }

        if(comboItems.some((comboItem)=>{
            const itemPrice = Number(comboItem.item.pricing);
            const itemDiscount = Number(comboItem.item.discount ?? 0);
            const itemPercentageDiscount = Number(comboItem.item.discountPercentage ?? 0);
            return !Number.isFinite(itemPrice) || itemPrice < 0 || !Number.isFinite(itemDiscount) || itemDiscount < 0 || !Number.isFinite(itemPercentageDiscount) || itemPercentageDiscount < 0;
        })){
            throw new apiError(400,"selected item pricing must be valid non-negative numbers");
        }

        dataToUpdate.comboKey = comboKey;
        dataToUpdate.totalPrice = comboTotalPrice;
        dataToUpdate.discount = comboDiscount;
        dataToUpdate.percentageDiscount = comboPercentageDiscount;
        dataToUpdate.finalPrice = comboFinalPrice;
        dataToUpdate.items = {
            deleteMany:{},
            create:comboItems.map((comboItem)=>({
                itemId:comboItem.item.id,
                quantity:comboItem.quantity
            }))
        };
    }else{
        if(req.body.totalPrice !== undefined) dataToUpdate.totalPrice = Number(req.body.totalPrice);
        if(req.body.discount !== undefined) dataToUpdate.discount = Number(req.body.discount);
        if(req.body.percentageDiscount !== undefined) dataToUpdate.percentageDiscount = Number(req.body.percentageDiscount);
        if(req.body.finalPrice !== undefined) dataToUpdate.finalPrice = Number(req.body.finalPrice);

        if(req.body.totalPrice !== undefined || req.body.discount !== undefined || req.body.percentageDiscount !== undefined || req.body.finalPrice !== undefined){
            const activeTotalPrice = dataToUpdate.totalPrice ?? existingCombo.totalPrice;
            const activeDiscount = dataToUpdate.discount ?? existingCombo.discount;
            const activePercentageDiscount = dataToUpdate.percentageDiscount ?? existingCombo.percentageDiscount;
            const activeFinalPrice = req.body.finalPrice === undefined
                ? Math.max(0,Math.round(activeTotalPrice - activeDiscount - (activeTotalPrice * activePercentageDiscount / 100)))
                : dataToUpdate.finalPrice;

            if(!Number.isFinite(activeTotalPrice) || !Number.isFinite(activeDiscount) || !Number.isFinite(activePercentageDiscount) || !Number.isFinite(activeFinalPrice)){
                throw new apiError(400,"combo pricing must be valid numbers");
            }

            if(activeTotalPrice < 0 || activeDiscount < 0 || activePercentageDiscount < 0 || activeFinalPrice < 0){
                throw new apiError(400,"combo pricing cannot be negative");
            }

            dataToUpdate.finalPrice = activeFinalPrice;
        }

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

            const existingSameCombo = await prisma.combo.findFirst({
                where:{
                    shopId:activeShopId,
                    comboKey,
                    id:{
                        not:comboId
                    }
                }
            });

            if(existingSameCombo){
                throw new apiError(409,"same combo already exists for this shop");
            }

            const existingCombosWithSameBase = await prisma.combo.findMany({
                where:{
                    shopId:activeShopId,
                    id:{
                        not:comboId
                    },
                    name:{
                        equals:activeComboName,
                        mode:"insensitive"
                    },
                    cuisineId:activeCuisineId || null,
                    categoryId:activeCategoryId || null
                },
                include:{
                    items:{
                        select:{
                            itemId:true,
                            quantity:true
                        }
                    }
                }
            });

            const duplicateCombo = existingCombosWithSameBase.find((existingCombo)=>{
                const existingItemKey = existingCombo.items
                    .map((comboItem)=>`${comboItem.itemId}:${comboItem.quantity}`)
                    .sort()
                    .join("|");

                return existingItemKey === comboItemKey;
            });

            if(duplicateCombo){
                throw new apiError(409,"same combo already exists for this shop");
            }

            dataToUpdate.comboKey = comboKey;
        }
    }

    if(Object.keys(dataToUpdate).length === 0){
        throw new apiError(400,"no combo data passed");
    }

    const updatedCombo = await prisma.combo.update({
        where:{
            id:comboId
        },
        data:dataToUpdate,
        include:comboInclude
    });

    return res.status(200).json(new apiResponse(200,updatedCombo,"combo updated successfully"));
});

const deleteCombo = asyncHandler(async(req,res)=>{
    const {comboId} = req.params;

    if(!comboId) throw new apiError(400,"combo id is required");

    const combo = await prisma.combo.findUnique({
        where:{
            id:comboId
        },
        select:{
            id:true,
            shopId:true
        }
    });

    if(!combo) throw new apiError(404,"combo not found");

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

    const deletedCombo = await prisma.combo.delete({
        where:{
            id:comboId
        }
    });

    return res.status(200).json(new apiResponse(200,deletedCombo,"combo deleted successfully"));
});

const getCombosByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;

    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");

    const combos = await prisma.combo.findMany({
        where:{
            shopId
        },
        orderBy:[
            {
                sortOrderId:"asc"
            },
            {
                createdAt:"desc"
            }
        ],
        include:comboInclude
    });

    return res.status(200).json(new apiResponse(200,{
        shop,
        combos
    },"shop combos fetched successfully"));
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

    const categories = await prisma.categories.findMany({
        where:{
            active:true,
            ...(cuisine?.id ? {cuisineId:cuisine.id} : {})
        },
        orderBy:{
            sortOrderId:"asc"
        }
    });

    const items = await prisma.shopItem.findMany({
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
        include:{
            item:{
                include:{
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
                    }
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,{
        selected:{
            shop,
            cuisine,
            category
        },
        categories,
        items
    },"combo builder data fetched successfully"));
});

export { createCombo, editCombo, deleteCombo, getCombosByShop, comboBuilder };
