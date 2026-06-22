import { prisma } from "../../db/index.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { getOrSetCachedData } from "../../utils/cache.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";

const offerInclude = {
    shop:{
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    },
    menus:{
        select:{
            id:true,
            menuId:true,
            menu:{
                select:{
                    id:true,
                    name:true,
                    active:true
                }
            }
        }
    },
    items:{
        select:{
            id:true,
            shopItemId:true,
            role:true,
            shopItem:{
                select:{
                    id:true,
                    pricing:true,
                    imageUrl:true,
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
    },
    combos:{
        select:{
            id:true,
            comboId:true,
            role:true,
            combo:{
                select:{
                    id:true,
                    name:true,
                    imageUrl:true,
                    totalPrice:true
                }
            }
        }
    },
    buyers:{
        select:{
            id:true,
            buyerId:true,
            buyer:{
                select:{
                    id:true,
                    name:true,
                    phone:true,
                    email:true
                }
            }
        }
    },
    tags:{
        select:{
            id:true,
            tagId:true,
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

const isTruthyInput = (value)=> value === true || String(value).toLowerCase() === "true";

const formatOfferListItem = (offer)=>({
    id:offer.id,
    shopId:offer.shopId,
    title:offer.title,
    description:offer.description,
    offerType:offer.offerType,
    active:offer.active,
    startsAt:offer.startsAt,
    endsAt:offer.endsAt,
    menuScope:offer.menuScope,
    applyTo:offer.applyTo,
    audienceType:offer.audienceType,
    stackingMode:offer.stackingMode,
    minQuantity:offer.minQuantity,
    minOrderAmount:offer.minOrderAmount,
    discountType:offer.discountType,
    discountValue:offer.discountValue,
    maxDiscountAmount:offer.maxDiscountAmount,
    rewardQuantity:offer.rewardQuantity,
    imageUrl:offer.imageUrl,
    createdAt:offer.createdAt,
    updatedAt:offer.updatedAt,
    shop:offer.shop ? {
        id:offer.shop.id,
        shopName:offer.shop.shopName,
        ownerId:offer.shop.ownerId
    } : null,
    menus:offer.menus?.map((menu)=>({
        id:menu.menuId,
        name:menu.menu?.name,
        active:menu.menu?.active
    })) || [],
    items:offer.items?.map((item)=>({
        id:item.shopItemId,
        role:item.role,
        pricing:item.shopItem?.pricing,
        imageUrl:item.shopItem?.imageUrl || item.shopItem?.item?.imageUrl || null,
        name:item.shopItem?.item?.name
    })) || [],
    combos:offer.combos?.map((combo)=>({
        id:combo.comboId,
        role:combo.role,
        name:combo.combo?.name,
        imageUrl:combo.combo?.imageUrl,
        totalPrice:combo.combo?.totalPrice
    })) || [],
    buyers:offer.buyers?.map((buyer)=>({
        id:buyer.buyerId,
        name:buyer.buyer?.name,
        phone:buyer.buyer?.phone,
        email:buyer.buyer?.email
    })) || [],
    tags:offer.tags?.map((tag)=>tag.tag) || []
});

const formatAvailableOfferListItem = (offer)=>({
    id:offer.id,
    shopId:offer.shopId,
    title:offer.title,
    description:offer.description,
    offerType:offer.offerType,
    startsAt:offer.startsAt,
    endsAt:offer.endsAt,
    menuScope:offer.menuScope,
    applyTo:offer.applyTo,
    audienceType:offer.audienceType,
    stackingMode:offer.stackingMode,
    minQuantity:offer.minQuantity,
    minOrderAmount:offer.minOrderAmount,
    discountType:offer.discountType,
    discountValue:offer.discountValue,
    maxDiscountAmount:offer.maxDiscountAmount,
    rewardQuantity:offer.rewardQuantity,
    imageUrl:offer.imageUrl,
    menus:offer.menus?.map((menu)=>({
        id:menu.menuId,
        name:menu.menu?.name
    })) || [],
    items:offer.items?.map((item)=>({
        id:item.shopItemId,
        role:item.role,
        name:item.shopItem?.item?.name,
        pricing:item.shopItem?.pricing,
        imageUrl:item.shopItem?.imageUrl || item.shopItem?.item?.imageUrl || null
    })) || [],
    combos:offer.combos?.map((combo)=>({
        id:combo.comboId,
        role:combo.role,
        name:combo.combo?.name,
        imageUrl:combo.combo?.imageUrl,
        totalPrice:combo.combo?.totalPrice
    })) || [],
    tags:offer.tags?.map((tag)=>({
        id:tag.tag?.id,
        name:tag.tag?.name
    })) || []
});

const getFirstOrderDiscountFields = (body)=>{
    const firstOrderDiscountValue = body.firstOrderDiscountValue ?? body.firstPurchaseDiscountValue ?? body.firstTimeBuyerDiscountValue;
    const firstOrderDiscountType = body.firstOrderDiscountType ?? body.firstPurchaseDiscountType ?? body.firstTimeBuyerDiscountType ?? body.discountType ?? "PERCENTAGE";
    const firstOrderOnly = body.firstOrderOnly ?? body.firstPurchaseOnly ?? body.firstTimeBuyerOnly;
    const enabled = isTruthyInput(firstOrderOnly) || firstOrderDiscountValue !== undefined;
    const normalizedDiscountType = String(firstOrderDiscountType).toUpperCase();

    return {
        enabled,
        discountValue:firstOrderDiscountValue,
        discountType:normalizedDiscountType,
        offerType:normalizedDiscountType === "FLAT" ? "FLAT_DISCOUNT" : "PERCENT_DISCOUNT"
    };
};

const createOffer = asyncHandler(async(req,res)=>{
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
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const {
        shopId,
        title,
        description,
        offerType,
        active,
        isActive,
        startsAt,
        endsAt,
        menuScope,
        menuIds,
        applyTo,
        itemIds,
        comboIds,
        buyItemIds,
        buyComboIds,
        rewardItemIds,
        rewardComboIds,
        audienceType,
        buyerIds,
        tagIds,
        stackingMode,
        minQuantity,
        minOrderAmount,
        discountType,
        discountValue,
        maxDiscountAmount,
        rewardQuantity,
        imageUrl
    } = req.body;

    if(!shopId) throw new apiError(400,"shopId is required");
    if(!title) throw new apiError(400,"title is required");
    if(!startsAt || !endsAt) throw new apiError(400,"startsAt and endsAt are required");

    const firstOrderDiscount = getFirstOrderDiscountFields(req.body);
    const offerTypeInput = firstOrderDiscount.enabled ? firstOrderDiscount.offerType : offerType;
    const applyToInput = firstOrderDiscount.enabled ? (applyTo || "ALL_CART") : applyTo;
    const audienceTypeInput = firstOrderDiscount.enabled ? "NEW_CUSTOMERS" : audienceType;
    const discountTypeInput = firstOrderDiscount.enabled ? firstOrderDiscount.discountType : discountType;
    const discountValueInput = firstOrderDiscount.enabled ? (firstOrderDiscount.discountValue ?? discountValue) : discountValue;

    if(!offerTypeInput) throw new apiError(400,"offerType is required");
    if(!applyToInput) throw new apiError(400,"applyTo is required");
    if(firstOrderDiscount.enabled && (discountValueInput === undefined || discountValueInput === null || discountValueInput === "")){
        throw new apiError(400,"first order discount value is required");
    }
    if(firstOrderDiscount.enabled && !["PERCENTAGE","FLAT"].includes(firstOrderDiscount.discountType)){
        throw new apiError(400,"first order discountType must be PERCENTAGE or FLAT");
    }

    const normalizedOfferType = String(offerTypeInput).toUpperCase();
    const normalizedMenuScope = menuScope ? String(menuScope).toUpperCase() : "ALL_MENUS";
    const requestedApplyTo = String(applyToInput).toUpperCase();
    const normalizedApplyTo = ["ALL_CART","ALL_ITEMS","ALL_ORDER","CART"].includes(requestedApplyTo)
        ? "ALL_CART"
        : requestedApplyTo === "ITEMS"
            ? "SPECIFIC_ITEMS"
            : requestedApplyTo === "COMBOS"
                ? "SPECIFIC_COMBOS"
                : requestedApplyTo;
    const normalizedAudienceType = audienceTypeInput ? String(audienceTypeInput).toUpperCase() : "ALL_BUYERS";
    const normalizedStackingMode = stackingMode ? String(stackingMode).toUpperCase() : "EXCLUSIVE";
    const normalizedDiscountType = discountTypeInput ? String(discountTypeInput).toUpperCase() : undefined;

    if(!["BUY_X_GET_Y","PERCENT_DISCOUNT","FLAT_DISCOUNT","FREE_DELIVERY","COMBO_DISCOUNT"].includes(normalizedOfferType)){
        throw new apiError(400,"invalid offerType");
    }
    if(!["ALL_MENUS","SPECIFIC_MENUS"].includes(normalizedMenuScope)) throw new apiError(400,"invalid menuScope");
    if(!["ALL_CART","SPECIFIC_ITEMS","SPECIFIC_COMBOS","ALL_ITEMS_IN_SELECTED_COMBOS"].includes(normalizedApplyTo)) throw new apiError(400,"invalid applyTo");
    if(!["ALL_BUYERS","SPECIFIC_BUYERS","TAG_BASED","PREMIUM_CUSTOMERS","NEW_CUSTOMERS"].includes(normalizedAudienceType)){
        throw new apiError(400,"invalid audienceType");
    }
    if(!["EXCLUSIVE","STACKABLE"].includes(normalizedStackingMode)) throw new apiError(400,"invalid stackingMode");
    if(normalizedDiscountType && !["PERCENTAGE","FLAT","FREE"].includes(normalizedDiscountType)) throw new apiError(400,"invalid discountType");

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if(Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) throw new apiError(400,"invalid startsAt or endsAt");
    if(endDate <= startDate) throw new apiError(400,"endsAt must be after startsAt");

    const selectedMenuIds = Array.isArray(menuIds) ? menuIds.map(String) : typeof menuIds === "string" && menuIds.trim() ? JSON.parse(menuIds).map(String) : [];
    const selectedItemIds = Array.isArray(itemIds) ? itemIds.map(String) : typeof itemIds === "string" && itemIds.trim() ? JSON.parse(itemIds).map(String) : [];
    const selectedComboIds = Array.isArray(comboIds) ? comboIds.map(String) : typeof comboIds === "string" && comboIds.trim() ? JSON.parse(comboIds).map(String) : [];
    const selectedBuyItemIds = Array.isArray(buyItemIds) ? buyItemIds.map(String) : typeof buyItemIds === "string" && buyItemIds.trim() ? JSON.parse(buyItemIds).map(String) : [];
    const selectedBuyComboIds = Array.isArray(buyComboIds) ? buyComboIds.map(String) : typeof buyComboIds === "string" && buyComboIds.trim() ? JSON.parse(buyComboIds).map(String) : [];
    const selectedRewardItemIds = Array.isArray(rewardItemIds) ? rewardItemIds.map(String) : typeof rewardItemIds === "string" && rewardItemIds.trim() ? JSON.parse(rewardItemIds).map(String) : [];
    const selectedRewardComboIds = Array.isArray(rewardComboIds) ? rewardComboIds.map(String) : typeof rewardComboIds === "string" && rewardComboIds.trim() ? JSON.parse(rewardComboIds).map(String) : [];
    const selectedBuyerIds = Array.isArray(buyerIds) ? buyerIds.map(String) : typeof buyerIds === "string" && buyerIds.trim() ? JSON.parse(buyerIds).map(String) : [];
    const selectedTagIds = Array.isArray(tagIds) ? tagIds.map(String) : typeof tagIds === "string" && tagIds.trim() ? JSON.parse(tagIds).map(String) : [];

    if(new Set(selectedMenuIds).size !== selectedMenuIds.length) throw new apiError(400,"duplicate menu ids are not allowed");
    if(new Set(selectedItemIds).size !== selectedItemIds.length) throw new apiError(400,"duplicate item ids are not allowed");
    if(new Set(selectedComboIds).size !== selectedComboIds.length) throw new apiError(400,"duplicate combo ids are not allowed");
    if(new Set(selectedBuyerIds).size !== selectedBuyerIds.length) throw new apiError(400,"duplicate buyer ids are not allowed");
    if(new Set(selectedTagIds).size !== selectedTagIds.length) throw new apiError(400,"duplicate tag ids are not allowed");


    if(normalizedMenuScope === "SPECIFIC_MENUS" && selectedMenuIds.length === 0) throw new apiError(400,"menuIds are required for specific menus");
    if(normalizedApplyTo === "SPECIFIC_ITEMS" && selectedItemIds.length === 0) throw new apiError(400,"itemIds are required when applyTo is SPECIFIC_ITEMS");
    if(normalizedApplyTo === "SPECIFIC_COMBOS" && selectedComboIds.length === 0) throw new apiError(400,"comboIds are required when applyTo is SPECIFIC_COMBOS");
    if(normalizedApplyTo === "ALL_ITEMS_IN_SELECTED_COMBOS" && selectedComboIds.length === 0) throw new apiError(400,"comboIds are required when applyTo is ALL_ITEMS_IN_SELECTED_COMBOS");
    if(normalizedAudienceType === "SPECIFIC_BUYERS" && selectedBuyerIds.length === 0) throw new apiError(400,"buyerIds are required for specific buyers");
    if(normalizedAudienceType === "TAG_BASED" && selectedTagIds.length === 0) throw new apiError(400,"tagIds are required for tag based audience");

    const shop = await prisma.shop.findUnique({
        where:{
            id:String(shopId)
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role === "SELLER" && shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage offers for your own shop");

    if(selectedMenuIds.length > 0){
        const menus = await prisma.menu.findMany({
            where:{
                id:{
                    in:selectedMenuIds
                },
                shopId:shop.id
            },
            select:{
                id:true
            }
        });
        if(menus.length !== selectedMenuIds.length) throw new apiError(400,"one or more menus are invalid for this shop");
    }

    const allItemIds = [...new Set([...selectedItemIds,...selectedBuyItemIds,...selectedRewardItemIds])];
    if(allItemIds.length > 0){
        const items = await prisma.shopItem.findMany({
            where:{
                id:{
                    in:allItemIds
                },
                shopId:shop.id
            },
            select:{
                id:true
            }
        });
        if(items.length !== allItemIds.length) throw new apiError(400,"one or more items are invalid for this shop");
    }

    const allComboIds = [...new Set([...selectedComboIds,...selectedBuyComboIds,...selectedRewardComboIds])];
    if(allComboIds.length > 0){
        const combos = await prisma.combo.findMany({
            where:{
                id:{
                    in:allComboIds
                },
                shopId:shop.id
            },
            select:{
                id:true
            }
        });
        if(combos.length !== allComboIds.length) throw new apiError(400,"one or more combos are invalid for this shop");
    }

    if(selectedBuyerIds.length > 0){
        const buyers = await prisma.user.findMany({
            where:{
                id:{
                    in:selectedBuyerIds
                },
                role:"BUYER"
            },
            select:{
                id:true
            }
        });
        if(buyers.length !== selectedBuyerIds.length) throw new apiError(400,"one or more buyers are invalid");
    }

    if(selectedTagIds.length > 0){
        const tags = await prisma.tag.findMany({
            where:{
                id:{
                    in:selectedTagIds
                }
            },
            select:{
                id:true
            }
        });
        if(tags.length !== selectedTagIds.length) throw new apiError(400,"one or more tags are invalid");
    }

    const offerImg = req.files?.offerImg?.[0]?.path;
    let uploadedImageUrl = null;
    if(offerImg){
        const imgUrl = await cloudUploader(offerImg);
        if(!imgUrl?.url) throw new apiError(400,"offer image upload failed");
        uploadedImageUrl = imgUrl.url;
    }

    const offerItemsToCreate = [
        ...selectedItemIds.map((shopItemId)=>({ shopItemId, role:"APPLIES_TO" })),
        ...selectedBuyItemIds.map((shopItemId)=>({ shopItemId, role:"CUSTOMER_BUYS" })),
        ...selectedRewardItemIds.map((shopItemId)=>({ shopItemId, role:"CUSTOMER_GETS" }))
    ];
    const offerCombosToCreate = [
        ...selectedComboIds.map((comboId)=>({ comboId, role:"APPLIES_TO" })),
        ...selectedBuyComboIds.map((comboId)=>({ comboId, role:"CUSTOMER_BUYS" })),
        ...selectedRewardComboIds.map((comboId)=>({ comboId, role:"CUSTOMER_GETS" }))
    ];

    const offer = await prisma.offer.create({
        data:{
            shopId:shop.id,
            title,
            description:description || undefined,
            offerType:normalizedOfferType,
            active:active === undefined && isActive === undefined ? true : active === true || isActive === true || String(active ?? isActive).toLowerCase() === "true",
            startsAt:startDate,
            endsAt:endDate,
            menuScope:normalizedMenuScope,
            applyTo:normalizedApplyTo,
            audienceType:normalizedAudienceType,
            stackingMode:normalizedStackingMode,
            minQuantity:minQuantity === undefined || minQuantity === null || minQuantity === "" ? undefined : Number(minQuantity),
            minOrderAmount:minOrderAmount === undefined || minOrderAmount === null || minOrderAmount === "" ? undefined : Number(minOrderAmount),
            discountType:normalizedDiscountType,
            discountValue:discountValueInput === undefined || discountValueInput === null || discountValueInput === "" ? undefined : Number(discountValueInput),
            maxDiscountAmount:maxDiscountAmount === undefined || maxDiscountAmount === null || maxDiscountAmount === "" ? undefined : Number(maxDiscountAmount),
            rewardQuantity:rewardQuantity === undefined || rewardQuantity === null || rewardQuantity === "" ? undefined : Number(rewardQuantity),
            imageUrl:uploadedImageUrl || imageUrl || undefined,
            menus:selectedMenuIds.length > 0 ? {
                create:selectedMenuIds.map((menuId)=>({
                    menuId
                }))
            } : undefined,
            items:offerItemsToCreate.length > 0 ? { create:offerItemsToCreate } : undefined,
            combos:offerCombosToCreate.length > 0 ? { create:offerCombosToCreate } : undefined,
            buyers:selectedBuyerIds.length > 0 ? {
                create:selectedBuyerIds.map((buyerId)=>({
                    buyerId
                }))
            } : undefined,
            tags:selectedTagIds.length > 0 ? {
                create:selectedTagIds.map((tagId)=>({
                    tagId
                }))
            } : undefined
        },
        include:offerInclude
    });

    return res.status(201).json(new apiResponse(201,offer,"offer created successfully"));
});

const fetchOffersByShop = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
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
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role === "SELLER" && shop.ownerId !== currentUser.id) throw new apiError(403,"You can only fetch offers for your own shop");

    const where = {
        shopId:shop.id
    };

    const [offers,total] = await Promise.all([
        prisma.offer.findMany({
            where,
            include:offerInclude,
            orderBy:{
                createdAt:"desc"
            },
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.offer.count({ where })
    ]);

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        offers:offers.map(formatOfferListItem)
    },"shop offers fetched successfully"));
});

const fetchOfferById = asyncHandler(async(req,res)=>{
    const { offerId } = req.params;

    if(!offerId) throw new apiError(400,"offer id is required");

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

    const offer = await prisma.offer.findUnique({
        where:{
            id:offerId
        },
        include:offerInclude
    });

    if(!offer) throw new apiError(404,"offer not found");
    if(currentUser.role === "SELLER" && offer.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only fetch offers for your own shop");

    return res.status(200).json(new apiResponse(200,offer,"offer fetched successfully"));
});

const updateOffer = asyncHandler(async(req,res)=>{
    const { offerId } = req.params;

    if(!offerId) throw new apiError(400,"offer id is required");

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
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const existingOffer = await prisma.offer.findUnique({
        where:{
            id:offerId
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

    if(!existingOffer) throw new apiError(404,"offer not found");
    if(currentUser.role === "SELLER" && existingOffer.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage offers for your own shop");

    const dataToUpdate = {};
    const {
        title,
        description,
        offerType,
        active,
        isActive,
        startsAt,
        endsAt,
        menuScope,
        menuIds,
        applyTo,
        itemIds,
        comboIds,
        buyItemIds,
        buyComboIds,
        rewardItemIds,
        rewardComboIds,
        audienceType,
        buyerIds,
        tagIds,
        stackingMode,
        minQuantity,
        minOrderAmount,
        discountType,
        discountValue,
        maxDiscountAmount,
        rewardQuantity,
        imageUrl
    } = req.body;

    const firstOrderDiscount = getFirstOrderDiscountFields(req.body);
    const firstOrderDiscountValueInput = firstOrderDiscount.discountValue ?? discountValue;
    if(firstOrderDiscount.enabled){
        if(firstOrderDiscount.discountType && !["PERCENTAGE","FLAT"].includes(firstOrderDiscount.discountType)){
            throw new apiError(400,"first order discountType must be PERCENTAGE or FLAT");
        }

        dataToUpdate.audienceType = "NEW_CUSTOMERS";
        dataToUpdate.applyTo = "ALL_CART";
        dataToUpdate.discountType = firstOrderDiscount.discountType;
        dataToUpdate.offerType = firstOrderDiscount.offerType;

        if(firstOrderDiscountValueInput !== undefined){
            dataToUpdate.discountValue = firstOrderDiscountValueInput === null || firstOrderDiscountValueInput === "" ? null : Number(firstOrderDiscountValueInput);
        }
    }

    if(title !== undefined) dataToUpdate.title = title;
    if(description !== undefined) dataToUpdate.description = description;
    if(active !== undefined || isActive !== undefined) dataToUpdate.active = active === true || isActive === true || String(active ?? isActive).toLowerCase() === "true";
    if(offerType !== undefined && !firstOrderDiscount.enabled){
        const normalizedOfferType = String(offerType).toUpperCase();
        if(!["BUY_X_GET_Y","PERCENT_DISCOUNT","FLAT_DISCOUNT","FREE_DELIVERY","COMBO_DISCOUNT"].includes(normalizedOfferType)) throw new apiError(400,"invalid offerType");
        dataToUpdate.offerType = normalizedOfferType;
    }
    if(menuScope !== undefined){
        const normalizedMenuScope = String(menuScope).toUpperCase();
        if(!["ALL_MENUS","SPECIFIC_MENUS"].includes(normalizedMenuScope)) throw new apiError(400,"invalid menuScope");
        dataToUpdate.menuScope = normalizedMenuScope;
    }
    if(applyTo !== undefined && !firstOrderDiscount.enabled){
        const requestedApplyTo = String(applyTo).toUpperCase();
        const normalizedApplyTo = ["ALL_CART","ALL_ITEMS","ALL_ORDER","CART"].includes(requestedApplyTo)
            ? "ALL_CART"
            : requestedApplyTo === "ITEMS"
                ? "SPECIFIC_ITEMS"
                : requestedApplyTo === "COMBOS"
                    ? "SPECIFIC_COMBOS"
                    : requestedApplyTo;
        if(!["ALL_CART","SPECIFIC_ITEMS","SPECIFIC_COMBOS","ALL_ITEMS_IN_SELECTED_COMBOS"].includes(normalizedApplyTo)) throw new apiError(400,"invalid applyTo");
        dataToUpdate.applyTo = normalizedApplyTo;
    }
    if(audienceType !== undefined && !firstOrderDiscount.enabled){
        const normalizedAudienceType = String(audienceType).toUpperCase();
        if(!["ALL_BUYERS","SPECIFIC_BUYERS","TAG_BASED","PREMIUM_CUSTOMERS","NEW_CUSTOMERS"].includes(normalizedAudienceType)) throw new apiError(400,"invalid audienceType");
        dataToUpdate.audienceType = normalizedAudienceType;
    }
    if(stackingMode !== undefined){
        const normalizedStackingMode = String(stackingMode).toUpperCase();
        if(!["EXCLUSIVE","STACKABLE"].includes(normalizedStackingMode)) throw new apiError(400,"invalid stackingMode");
        dataToUpdate.stackingMode = normalizedStackingMode;
    }
    if(discountType !== undefined && !firstOrderDiscount.enabled){
        const normalizedDiscountType = discountType ? String(discountType).toUpperCase() : null;
        if(normalizedDiscountType && !["PERCENTAGE","FLAT","FREE"].includes(normalizedDiscountType)) throw new apiError(400,"invalid discountType");
        dataToUpdate.discountType = normalizedDiscountType;
    }
    if(startsAt !== undefined){
        const startDate = new Date(startsAt);
        if(Number.isNaN(startDate.getTime())) throw new apiError(400,"invalid startsAt");
        dataToUpdate.startsAt = startDate;
    }
    if(endsAt !== undefined){
        const endDate = new Date(endsAt);
        if(Number.isNaN(endDate.getTime())) throw new apiError(400,"invalid endsAt");
        dataToUpdate.endsAt = endDate;
    }
    const finalStartDate = dataToUpdate.startsAt || existingOffer.startsAt;
    const finalEndDate = dataToUpdate.endsAt || existingOffer.endsAt;
    if(finalEndDate <= finalStartDate) throw new apiError(400,"endsAt must be after startsAt");

    if(minQuantity !== undefined) dataToUpdate.minQuantity = minQuantity === null || minQuantity === "" ? null : Number(minQuantity);
    if(minOrderAmount !== undefined) dataToUpdate.minOrderAmount = minOrderAmount === null || minOrderAmount === "" ? null : Number(minOrderAmount);
    if(discountValue !== undefined && !firstOrderDiscount.enabled) dataToUpdate.discountValue = discountValue === null || discountValue === "" ? null : Number(discountValue);
    if(maxDiscountAmount !== undefined) dataToUpdate.maxDiscountAmount = maxDiscountAmount === null || maxDiscountAmount === "" ? null : Number(maxDiscountAmount);
    if(rewardQuantity !== undefined) dataToUpdate.rewardQuantity = rewardQuantity === null || rewardQuantity === "" ? null : Number(rewardQuantity);
    if(imageUrl !== undefined) dataToUpdate.imageUrl = imageUrl;

    const offerImg = req.files?.offerImg?.[0]?.path;
    if(offerImg){
        const imgUrl = await cloudUploader(offerImg);
        if(!imgUrl?.url) throw new apiError(400,"offer image upload failed");
        dataToUpdate.imageUrl = imgUrl.url;
    }

    const selectedMenuIds = menuIds !== undefined ? (Array.isArray(menuIds) ? menuIds.map(String) : typeof menuIds === "string" && menuIds.trim() ? JSON.parse(menuIds).map(String) : []) : null;
    const selectedItemIds = itemIds !== undefined ? (Array.isArray(itemIds) ? itemIds.map(String) : typeof itemIds === "string" && itemIds.trim() ? JSON.parse(itemIds).map(String) : []) : null;
    const selectedComboIds = comboIds !== undefined ? (Array.isArray(comboIds) ? comboIds.map(String) : typeof comboIds === "string" && comboIds.trim() ? JSON.parse(comboIds).map(String) : []) : null;
    const selectedBuyItemIds = buyItemIds !== undefined ? (Array.isArray(buyItemIds) ? buyItemIds.map(String) : typeof buyItemIds === "string" && buyItemIds.trim() ? JSON.parse(buyItemIds).map(String) : []) : null;
    const selectedBuyComboIds = buyComboIds !== undefined ? (Array.isArray(buyComboIds) ? buyComboIds.map(String) : typeof buyComboIds === "string" && buyComboIds.trim() ? JSON.parse(buyComboIds).map(String) : []) : null;
    const selectedRewardItemIds = rewardItemIds !== undefined ? (Array.isArray(rewardItemIds) ? rewardItemIds.map(String) : typeof rewardItemIds === "string" && rewardItemIds.trim() ? JSON.parse(rewardItemIds).map(String) : []) : null;
    const selectedRewardComboIds = rewardComboIds !== undefined ? (Array.isArray(rewardComboIds) ? rewardComboIds.map(String) : typeof rewardComboIds === "string" && rewardComboIds.trim() ? JSON.parse(rewardComboIds).map(String) : []) : null;
    const selectedBuyerIds = buyerIds !== undefined ? (Array.isArray(buyerIds) ? buyerIds.map(String) : typeof buyerIds === "string" && buyerIds.trim() ? JSON.parse(buyerIds).map(String) : []) : null;
    const selectedTagIds = tagIds !== undefined ? (Array.isArray(tagIds) ? tagIds.map(String) : typeof tagIds === "string" && tagIds.trim() ? JSON.parse(tagIds).map(String) : []) : null;

    if(selectedMenuIds && new Set(selectedMenuIds).size !== selectedMenuIds.length) throw new apiError(400,"duplicate menu ids are not allowed");
    if(selectedItemIds && new Set(selectedItemIds).size !== selectedItemIds.length) throw new apiError(400,"duplicate item ids are not allowed");
    if(selectedComboIds && new Set(selectedComboIds).size !== selectedComboIds.length) throw new apiError(400,"duplicate combo ids are not allowed");
    if(selectedBuyerIds && new Set(selectedBuyerIds).size !== selectedBuyerIds.length) throw new apiError(400,"duplicate buyer ids are not allowed");
    if(selectedTagIds && new Set(selectedTagIds).size !== selectedTagIds.length) throw new apiError(400,"duplicate tag ids are not allowed");

    if(selectedMenuIds){
        if((dataToUpdate.menuScope || existingOffer.menuScope) === "SPECIFIC_MENUS" && selectedMenuIds.length === 0) throw new apiError(400,"menuIds are required for specific menus");
        const menus = await prisma.menu.findMany({
            where:{
                id:{
                    in:selectedMenuIds
                },
                shopId:existingOffer.shop.id
            },
            select:{
                id:true
            }
        });
        if(menus.length !== selectedMenuIds.length) throw new apiError(400,"one or more menus are invalid for this shop");
        dataToUpdate.menus = {
            deleteMany:{},
            create:selectedMenuIds.map((menuId)=>({ menuId }))
        };
    }

    if(selectedItemIds || selectedBuyItemIds || selectedRewardItemIds){
        const finalItemIds = selectedItemIds || [];
        const finalBuyItemIds = selectedBuyItemIds || [];
        const finalRewardItemIds = selectedRewardItemIds || [];
        const allItemIds = [...new Set([...finalItemIds,...finalBuyItemIds,...finalRewardItemIds])];
        if((dataToUpdate.applyTo || existingOffer.applyTo) === "SPECIFIC_ITEMS" && finalItemIds.length === 0) throw new apiError(400,"itemIds are required when applyTo is SPECIFIC_ITEMS");
        if(allItemIds.length > 0){
            const items = await prisma.shopItem.findMany({
                where:{
                    id:{
                        in:allItemIds
                    },
                    shopId:existingOffer.shop.id
                },
                select:{
                    id:true
                }
            });
            if(items.length !== allItemIds.length) throw new apiError(400,"one or more items are invalid for this shop");
        }
        dataToUpdate.items = {
            deleteMany:{},
            create:[
                ...finalItemIds.map((shopItemId)=>({ shopItemId, role:"APPLIES_TO" })),
                ...finalBuyItemIds.map((shopItemId)=>({ shopItemId, role:"CUSTOMER_BUYS" })),
                ...finalRewardItemIds.map((shopItemId)=>({ shopItemId, role:"CUSTOMER_GETS" }))
            ]
        };
    }

    if(selectedComboIds || selectedBuyComboIds || selectedRewardComboIds){
        const finalComboIds = selectedComboIds || [];
        const finalBuyComboIds = selectedBuyComboIds || [];
        const finalRewardComboIds = selectedRewardComboIds || [];
        const allComboIds = [...new Set([...finalComboIds,...finalBuyComboIds,...finalRewardComboIds])];
        if((dataToUpdate.applyTo || existingOffer.applyTo) === "SPECIFIC_COMBOS" && finalComboIds.length === 0) throw new apiError(400,"comboIds are required when applyTo is SPECIFIC_COMBOS");
        if((dataToUpdate.applyTo || existingOffer.applyTo) === "ALL_ITEMS_IN_SELECTED_COMBOS" && finalComboIds.length === 0) throw new apiError(400,"comboIds are required when applyTo is ALL_ITEMS_IN_SELECTED_COMBOS");
        if(allComboIds.length > 0){
            const combos = await prisma.combo.findMany({
                where:{
                    id:{
                        in:allComboIds
                    },
                    shopId:existingOffer.shop.id
                },
                select:{
                    id:true
                }
            });
            if(combos.length !== allComboIds.length) throw new apiError(400,"one or more combos are invalid for this shop");
        }
        dataToUpdate.combos = {
            deleteMany:{},
            create:[
                ...finalComboIds.map((comboId)=>({ comboId, role:"APPLIES_TO" })),
                ...finalBuyComboIds.map((comboId)=>({ comboId, role:"CUSTOMER_BUYS" })),
                ...finalRewardComboIds.map((comboId)=>({ comboId, role:"CUSTOMER_GETS" }))
            ]
        };
    }

    if(selectedBuyerIds){
        if((dataToUpdate.audienceType || existingOffer.audienceType) === "SPECIFIC_BUYERS" && selectedBuyerIds.length === 0) throw new apiError(400,"buyerIds are required for specific buyers");
        const buyers = await prisma.user.findMany({
            where:{
                id:{
                    in:selectedBuyerIds
                },
                role:"BUYER"
            },
            select:{
                id:true
            }
        });
        if(buyers.length !== selectedBuyerIds.length) throw new apiError(400,"one or more buyers are invalid");
        dataToUpdate.buyers = {
            deleteMany:{},
            create:selectedBuyerIds.map((buyerId)=>({ buyerId }))
        };
    }

    if(selectedTagIds){
        if((dataToUpdate.audienceType || existingOffer.audienceType) === "TAG_BASED" && selectedTagIds.length === 0) throw new apiError(400,"tagIds are required for tag based audience");
        const tags = await prisma.tag.findMany({
            where:{
                id:{
                    in:selectedTagIds
                }
            },
            select:{
                id:true
            }
        });
        if(tags.length !== selectedTagIds.length) throw new apiError(400,"one or more tags are invalid");
        dataToUpdate.tags = {
            deleteMany:{},
            create:selectedTagIds.map((tagId)=>({ tagId }))
        };
    }

    const offer = await prisma.offer.update({
        where:{
            id:existingOffer.id
        },
        data:dataToUpdate,
        include:offerInclude
    });

    return res.status(200).json(new apiResponse(200,offer,"offer updated successfully"));
});

const updateOfferActiveStatus = asyncHandler(async(req,res)=>{
    const { offerId } = req.params;
    const { active, isActive } = req.body;

    if(!offerId) throw new apiError(400,"offer id is required");
    if(active === undefined && isActive === undefined) throw new apiError(400,"active status is required");

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
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const offer = await prisma.offer.findUnique({
        where:{
            id:offerId
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

    if(!offer) throw new apiError(404,"offer not found");
    if(currentUser.role === "SELLER" && offer.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage offers for your own shop");

    const updatedOffer = await prisma.offer.update({
        where:{
            id:offer.id
        },
        data:{
            active:active === true || isActive === true || String(active ?? isActive).toLowerCase() === "true"
        },
        include:offerInclude
    });

    return res.status(200).json(new apiResponse(200,updatedOffer,"offer active status updated successfully"));
});

const deleteOffer = asyncHandler(async(req,res)=>{
    const { offerId } = req.params;

    if(!offerId) throw new apiError(400,"offer id is required");

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
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

    const offer = await prisma.offer.findUnique({
        where:{
            id:offerId
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

    if(!offer) throw new apiError(404,"offer not found");
    if(currentUser.role === "SELLER" && offer.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage offers for your own shop");

    const deletedOffer = await prisma.offer.delete({
        where:{
            id:offer.id
        }
    });

    return res.status(200).json(new apiResponse(200,deletedOffer,"offer deleted successfully"));
});

const fetchAvailableOffersByShop = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
    const pagination = getPagination(req.query);

    if(!shopId) throw new apiError(400,"shop id is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            billingPlan:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const cacheKey = `buyer:${currentUser.id}:shop:${shopId}:available-offers:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const now = new Date();
        const [offers,completedOffer] = await Promise.all([
            prisma.offer.findMany({
                where:{
                    shopId,
                    active:true,
                    startsAt:{
                        lte:now
                    },
                    endsAt:{
                        gte:now
                    }
                },
                include:offerInclude,
                orderBy:{
                    createdAt:"desc"
                }
            }),
            prisma.buyerCompletedOffer.findFirst({
                where:{
                    buyerId:currentUser.id,
                    shopId
                },
                select:{
                    id:true
                }
            })
        ]);

        const availableOffers = offers.filter((offer)=>{
            if(offer.audienceType === "ALL_BUYERS") return true;
            if(offer.audienceType === "SPECIFIC_BUYERS") return offer.buyers.some((buyer)=>buyer.buyerId === currentUser.id);
            if(offer.audienceType === "PREMIUM_CUSTOMERS") return currentUser.billingPlan === "ACTIVE";
            if(offer.audienceType === "NEW_CUSTOMERS") return !completedOffer;
            if(offer.audienceType === "TAG_BASED") return false;
            return false;
        });

        const pagedOffers = availableOffers.slice(pagination.skip,pagination.skip + pagination.take);

        return {
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total:availableOffers.length
            }),
            offers:pagedOffers.map(formatAvailableOfferListItem)
        };
    },30);

    return res.status(200).json(new apiResponse(200,responseData,"available offers fetched successfully"));
});

const searchBuyersForOfferTarget = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;
    const { query } = req.query;
    const pagination = getPagination(req.query,{defaultLimit:25,maxLimit:50});

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
    if(currentUser.role !== "SELLER" && currentUser.role !== "ADMIN") throw new apiError(403,"Seller or admin access required");

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
    if(currentUser.role === "SELLER" && shop.ownerId !== currentUser.id) throw new apiError(403,"You can only search buyers for your own shop");

    const searchText = query ? String(query).trim() : "";
    const where = {
        role:"BUYER",
        ...(searchText ? {
            OR:[
                {
                    name:{
                        contains:searchText,
                        mode:"insensitive"
                    }
                },
                {
                    phone:{
                        contains:searchText
                    }
                },
                {
                    email:{
                        contains:searchText,
                        mode:"insensitive"
                    }
                }
            ]
        } : {})
    };

    const [buyers,total] = await Promise.all([
        prisma.user.findMany({
            where,
            select:{
                id:true,
                name:true,
                phone:true,
                email:true,
                billingPlan:true,
                completedOffers:{
                    where:{
                        shopId:shop.id
                    },
                    select:{
                        id:true,
                        totalAmount:true,
                        completedAt:true
                    },
                    orderBy:{
                        completedAt:"desc"
                    }
                }
            },
            skip:pagination.skip,
            take:pagination.take,
            orderBy:{
                createdAt:"desc"
            }
        }),
        prisma.user.count({ where })
    ]);

    if (!buyers) throw new apiError(400, "")

    const responseBuyers = buyers.map((buyer)=>({
        id:buyer.id,
        name:buyer.name,
        phone:buyer.phone,
        email:buyer.email,
        billingPlan:buyer.billingPlan,
        qualifyingOrdersAtShop:buyer.completedOffers.length,
        isNewCustomerAtShop:buyer.completedOffers.length === 0,
        lastCompletedOrderAtShop:buyer.completedOffers[0]?.completedAt || null
    }));

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        buyers:responseBuyers
    },"buyers fetched successfully"));
});

export {
    createOffer,
    deleteOffer,
    fetchAvailableOffersByShop,
    fetchOfferById,
    fetchOffersByShop,
    searchBuyersForOfferTarget,
    updateOffer,
    updateOfferActiveStatus
};
