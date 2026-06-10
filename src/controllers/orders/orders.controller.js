import { prisma } from "../../db/index.js";
import { asyncHandler, apiError, apiResponse } from "../../utils/handler.js";

const VALID_PAYMENT_METHODS = ["CASH","CARD","UPI"];

const orderInventoryInclude = {
    shop:{
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    },
    orderItems:{
        select:{
            id:true,
            orderItemType:true,
            shopItemId:true,
            comboId:true,
            name:true,
            quantity:true,
            priceAtOrderTime:true,
            totalPrice:true,
            shopItem:{
                select:{
                    id:true,
                    availableQuantity:true,
                    item:{
                        select:{
                            id:true,
                            name:true
                        }
                    }
                }
            },
            combo:{
                select:{
                    id:true,
                    name:true,
                    availableQuantity:true,
                    items:{
                        select:{
                            quantity:true,
                            item:{
                                select:{
                                    id:true,
                                    availableQuantity:true,
                                    item:{
                                        select:{
                                            id:true,
                                            name:true
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

const orderResponseInclude = {
    user:{
        select:{
            id:true,
            name:true,
            phone:true
        }
    },
    shop:{
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    },
    orderItems:{
        select:{
            id:true,
            orderItemType:true,
            shopItemId:true,
            comboId:true,
            name:true,
            quantity:true,
            priceAtOrderTime:true,
            totalPrice:true
        }
    }
};

const addInventoryUsage = (usageMap, inventoryItem, quantity, name)=>{
    if(!inventoryItem?.id) return;

    const existingUsage = usageMap.get(inventoryItem.id);
    if(existingUsage){
        existingUsage.quantity += quantity;
        return;
    }

    usageMap.set(inventoryItem.id,{
        id:inventoryItem.id,
        name,
        quantity,
        availableQuantity:inventoryItem.availableQuantity
    });
};

const getOrderInventoryUsage = (order)=>{
    const shopItemUsage = new Map();
    const comboUsage = new Map();

    order.orderItems.forEach((orderItem)=>{
        if(orderItem.orderItemType === "ITEM"){
            addInventoryUsage(
                shopItemUsage,
                orderItem.shopItem,
                orderItem.quantity,
                orderItem.shopItem?.item?.name || orderItem.name || "item"
            );
            return;
        }

        if(orderItem.orderItemType === "COMBO"){
            addInventoryUsage(comboUsage,orderItem.combo,orderItem.quantity,orderItem.combo?.name || orderItem.name || "combo");

            orderItem.combo?.items?.forEach((comboItem)=>{
                addInventoryUsage(
                    shopItemUsage,
                    comboItem.item,
                    comboItem.quantity * orderItem.quantity,
                    comboItem.item?.item?.name || "item"
                );
            });
        }
    });

    return {
        shopItemUsage:[...shopItemUsage.values()],
        comboUsage:[...comboUsage.values()]
    };
};

const createOrder = asyncHandler(async(req,res)=>{
    const {
        shopId,
        paymentMethod,
        paymentReceived,
        deliveryAmount,
        customerNote,
        items,
        itemIds,
        combos,
        comboIds,
        offerId,
        offerIds,
        appliedOfferIds
    } = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!paymentMethod) throw new apiError(400,"payment method is required");

    const normalizedPaymentMethod = String(paymentMethod).toUpperCase();
    if(!VALID_PAYMENT_METHODS.includes(normalizedPaymentMethod)){
        throw new apiError(400,"paymentMethod must be one of CASH, CARD, or UPI");
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
    if(currentUser.role !== "BUYER") throw new apiError(403,"Buyer access required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true,
            ShopOpenStatus:true,
            Verified:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");

    const selectedItems = Array.isArray(items) && items.length > 0 ? items : itemIds;
    const selectedCombos = Array.isArray(combos) && combos.length > 0 ? combos : comboIds;

    const normalizedItems = Array.isArray(selectedItems)
        ? selectedItems.map((item)=>{
            if(typeof item === "string"){
                return {
                    shopItemId:item,
                    quantity:1
                };
            }

            return {
                shopItemId:item.shopItemId || item.itemId || item.id,
                quantity:item.quantity === undefined || item.quantity === null ? 1 : Number(item.quantity)
            };
        })
        : [];

    const normalizedCombos = Array.isArray(selectedCombos)
        ? selectedCombos.map((combo)=>{
            if(typeof combo === "string"){
                return {
                    comboId:combo,
                    quantity:1
                };
            }

            return {
                comboId:combo.comboId || combo.id,
                quantity:combo.quantity === undefined || combo.quantity === null ? 1 : Number(combo.quantity)
            };
        })
        : [];

    if(normalizedItems.length === 0 && normalizedCombos.length === 0){
        throw new apiError(400,"order needs at least one item or combo");
    }

    if(normalizedItems.some((item)=>!item.shopItemId)){
        throw new apiError(400,"each order item needs a shopItemId");
    }

    if(normalizedCombos.some((combo)=>!combo.comboId)){
        throw new apiError(400,"each order combo needs a comboId");
    }

    if(normalizedItems.some((item)=>!Number.isInteger(item.quantity) || item.quantity < 1)){
        throw new apiError(400,"item quantity must be a positive integer");
    }

    if(normalizedCombos.some((combo)=>!Number.isInteger(combo.quantity) || combo.quantity < 1)){
        throw new apiError(400,"combo quantity must be a positive integer");
    }

    const uniqueShopItemIds = [...new Set(normalizedItems.map((item)=>String(item.shopItemId)))];
    const uniqueComboIds = [...new Set(normalizedCombos.map((combo)=>String(combo.comboId)))];

    if(uniqueShopItemIds.length !== normalizedItems.length){
        throw new apiError(400,"duplicate order items are not allowed");
    }

    if(uniqueComboIds.length !== normalizedCombos.length){
        throw new apiError(400,"duplicate order combos are not allowed");
    }

    const shopItemsData = uniqueShopItemIds.length > 0
        ? await prisma.shopItem.findMany({
            where:{
                id:{
                    in:uniqueShopItemIds
                },
                shopId,
                active:true
            },
            include:{
                item:{
                    select:{
                        id:true,
                        name:true
                    }
                }
            }
        })
        : [];

    if(shopItemsData.length !== uniqueShopItemIds.length){
        throw new apiError(400,"one or more items are invalid for this shop");
    }

    const combosData = uniqueComboIds.length > 0
        ? await prisma.combo.findMany({
            where:{
                id:{
                    in:uniqueComboIds
                },
                shopId,
                active:true
            },
            select:{
                id:true,
                name:true,
                totalPrice:true,
                finalPrice:true,
                availableQuantity:true,
                items:{
                    select:{
                        quantity:true,
                        item:{
                            select:{
                                id:true,
                                availableQuantity:true,
                                item:{
                                    select:{
                                        name:true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
        : [];

    if(combosData.length !== uniqueComboIds.length){
        throw new apiError(400,"one or more combos are invalid for this shop");
    }

    const orderItemsToCreate = [];
    const shopItemQuantityUsage = new Map();

    const addShopItemQuantityUsage = (shopItem, quantity)=>{
        const existingUsage = shopItemQuantityUsage.get(shopItem.id);

        if(existingUsage){
            existingUsage.quantity += quantity;
            return;
        }

        shopItemQuantityUsage.set(shopItem.id,{
            id:shopItem.id,
            name:shopItem.item?.name || "item",
            availableQuantity:shopItem.availableQuantity,
            quantity
        });
    };

    normalizedItems.forEach((selectedItem)=>{
        const shopItem = shopItemsData.find((currentItem)=>currentItem.id === String(selectedItem.shopItemId));
        const itemPrice = Number(shopItem.pricing);

        if(!Number.isInteger(itemPrice) || itemPrice < 0){
            throw new apiError(400,`${shopItem.item.name} has invalid pricing`);
        }

        addShopItemQuantityUsage(shopItem,selectedItem.quantity);

        orderItemsToCreate.push({
            orderItemType:"ITEM",
            shopItemId:shopItem.id,
            name:shopItem.item.name,
            quantity:selectedItem.quantity,
            priceAtOrderTime:itemPrice,
            totalPrice:itemPrice * selectedItem.quantity
        });
    });

    normalizedCombos.forEach((selectedCombo)=>{
        const combo = combosData.find((currentCombo)=>currentCombo.id === String(selectedCombo.comboId));
        const comboPrice = Number(combo.finalPrice ?? combo.totalPrice);

        if(!Number.isInteger(comboPrice) || comboPrice < 0){
            throw new apiError(400,`${combo.name} has invalid pricing`);
        }

        if(combo.availableQuantity !== null && selectedCombo.quantity > combo.availableQuantity){
            throw new apiError(400,`${combo.name} does not have enough quantity`);
        }

        combo.items.forEach((comboItem)=>{
            addShopItemQuantityUsage(comboItem.item,comboItem.quantity * selectedCombo.quantity);
        });

        orderItemsToCreate.push({
            orderItemType:"COMBO",
            comboId:combo.id,
            name:combo.name,
            quantity:selectedCombo.quantity,
            priceAtOrderTime:comboPrice,
            totalPrice:comboPrice * selectedCombo.quantity
        });
    });

    shopItemQuantityUsage.forEach((usage)=>{
        if(usage.availableQuantity !== null && usage.quantity > usage.availableQuantity){
            throw new apiError(400,`${usage.name} does not have enough quantity`);
        }
    });

    const subtotalAmount = orderItemsToCreate.reduce((total,currentItem)=>total + currentItem.totalPrice,0);
    const normalizedDeliveryAmount = deliveryAmount === undefined || deliveryAmount === null ? 0 : Number(deliveryAmount);

    if(!Number.isInteger(normalizedDeliveryAmount) || normalizedDeliveryAmount < 0){
        throw new apiError(400,"deliveryAmount must be a valid number");
    }

    const rawOfferInput = appliedOfferIds ?? offerIds ?? offerId;
    let selectedOfferIds = [];
    if(Array.isArray(rawOfferInput)){
        selectedOfferIds = rawOfferInput.map(String).filter(Boolean);
    }else if(typeof rawOfferInput === "string" && rawOfferInput.trim()){
        const trimmedOfferInput = rawOfferInput.trim();
        selectedOfferIds = trimmedOfferInput.startsWith("[")
            ? JSON.parse(trimmedOfferInput).map(String).filter(Boolean)
            : [trimmedOfferInput];
    }else if(rawOfferInput){
        selectedOfferIds = [String(rawOfferInput)];
    }

    if(new Set(selectedOfferIds).size !== selectedOfferIds.length){
        throw new apiError(400,"duplicate offer ids are not allowed");
    }

    const selectedItemQuantityById = new Map();
    const selectedComboQuantityById = new Map();
    const selectedItemTotalById = new Map();
    const selectedComboTotalById = new Map();
    const selectedItemUnitPriceById = new Map();
    const selectedComboUnitPriceById = new Map();

    orderItemsToCreate.forEach((orderItem)=>{
        if(orderItem.orderItemType === "ITEM"){
            selectedItemQuantityById.set(orderItem.shopItemId,(selectedItemQuantityById.get(orderItem.shopItemId) || 0) + orderItem.quantity);
            selectedItemTotalById.set(orderItem.shopItemId,(selectedItemTotalById.get(orderItem.shopItemId) || 0) + orderItem.totalPrice);
            selectedItemUnitPriceById.set(orderItem.shopItemId,orderItem.priceAtOrderTime);
            return;
        }

        if(orderItem.orderItemType === "COMBO"){
            selectedComboQuantityById.set(orderItem.comboId,(selectedComboQuantityById.get(orderItem.comboId) || 0) + orderItem.quantity);
            selectedComboTotalById.set(orderItem.comboId,(selectedComboTotalById.get(orderItem.comboId) || 0) + orderItem.totalPrice);
            selectedComboUnitPriceById.set(orderItem.comboId,orderItem.priceAtOrderTime);
        }
    });

    let discountAmount = 0;
    let deliveryDiscountAmount = 0;
    const appliedOffers = [];

    if(selectedOfferIds.length > 0){
        const now = new Date();
        const offersData = await prisma.offer.findMany({
            where:{
                id:{
                    in:selectedOfferIds
                },
                shopId,
                active:true,
                startsAt:{
                    lte:now
                },
                endsAt:{
                    gte:now
                }
            },
            include:{
                items:true,
                combos:true,
                buyers:true
            }
        });

        if(offersData.length !== selectedOfferIds.length){
            throw new apiError(400,"one or more offers are invalid or inactive for this shop");
        }

        if(selectedOfferIds.length > 1 && offersData.some((offer)=>offer.stackingMode !== "STACKABLE")){
            throw new apiError(400,"exclusive offers cannot be combined");
        }

        const hasNewCustomerOffer = offersData.some((offer)=>offer.audienceType === "NEW_CUSTOMERS");
        const completedOffer = hasNewCustomerOffer
            ? await prisma.buyerCompletedOffer.findFirst({
                where:{
                    buyerId:currentUser.id,
                    shopId
                },
                select:{
                    id:true
                }
            })
            : null;

        for(const offer of offersData){
            const appliesToItemIds = offer.items.filter((item)=>item.role === "APPLIES_TO").map((item)=>item.shopItemId);
            const buyItemIds = offer.items.filter((item)=>item.role === "CUSTOMER_BUYS").map((item)=>item.shopItemId);
            const rewardItemIds = offer.items.filter((item)=>item.role === "CUSTOMER_GETS").map((item)=>item.shopItemId);
            const appliesToComboIds = offer.combos.filter((combo)=>combo.role === "APPLIES_TO").map((combo)=>combo.comboId);
            const buyComboIds = offer.combos.filter((combo)=>combo.role === "CUSTOMER_BUYS").map((combo)=>combo.comboId);
            const rewardComboIds = offer.combos.filter((combo)=>combo.role === "CUSTOMER_GETS").map((combo)=>combo.comboId);

            if(offer.audienceType === "SPECIFIC_BUYERS" && !offer.buyers.some((buyer)=>buyer.buyerId === currentUser.id)){
                throw new apiError(400,`${offer.title} is not available for this buyer`);
            }
            if(offer.audienceType === "PREMIUM_CUSTOMERS" && currentUser.billingPlan !== "ACTIVE"){
                throw new apiError(400,`${offer.title} is only available for premium customers`);
            }
            if(offer.audienceType === "NEW_CUSTOMERS" && completedOffer){
                throw new apiError(400,`${offer.title} is only available for new customers`);
            }
            if(offer.audienceType === "TAG_BASED"){
                throw new apiError(400,`${offer.title} cannot be applied at checkout yet`);
            }
            if(offer.minOrderAmount !== null && offer.minOrderAmount !== undefined && subtotalAmount < offer.minOrderAmount){
                throw new apiError(400,`${offer.title} requires minimum order amount ${offer.minOrderAmount}`);
            }

            let targetAmount = 0;
            let targetQuantity = 0;

            if(offer.applyTo === "ALL_CART"){
                targetAmount = subtotalAmount;
                targetQuantity = orderItemsToCreate.reduce((total,orderItem)=>total + orderItem.quantity,0);
            }

            if(offer.applyTo === "SPECIFIC_ITEMS"){
                appliesToItemIds.forEach((shopItemId)=>{
                    targetAmount += selectedItemTotalById.get(shopItemId) || 0;
                    targetQuantity += selectedItemQuantityById.get(shopItemId) || 0;
                });
            }

            if(offer.applyTo === "SPECIFIC_COMBOS"){
                appliesToComboIds.forEach((comboId)=>{
                    targetAmount += selectedComboTotalById.get(comboId) || 0;
                    targetQuantity += selectedComboQuantityById.get(comboId) || 0;
                });
            }

            if(offer.applyTo === "ALL_ITEMS_IN_SELECTED_COMBOS"){
                appliesToComboIds.forEach((comboId)=>{
                    targetAmount += selectedComboTotalById.get(comboId) || 0;
                    targetQuantity += selectedComboQuantityById.get(comboId) || 0;
                });
            }

            if(offer.offerType === "FREE_DELIVERY"){
                targetAmount = normalizedDeliveryAmount;
                targetQuantity = 1;
            }

            if(offer.minQuantity !== null && offer.minQuantity !== undefined && targetQuantity < offer.minQuantity){
                throw new apiError(400,`${offer.title} requires minimum quantity ${offer.minQuantity}`);
            }

            if(targetAmount <= 0 && offer.offerType !== "BUY_X_GET_Y"){
                throw new apiError(400,`${offer.title} does not apply to selected cart items`);
            }

            let currentOfferDiscount = 0;
            let currentDeliveryDiscount = 0;

            if(offer.offerType === "BUY_X_GET_Y"){
                let buyQuantity = 0;
                buyItemIds.forEach((shopItemId)=>{
                    buyQuantity += selectedItemQuantityById.get(shopItemId) || 0;
                });
                buyComboIds.forEach((comboId)=>{
                    buyQuantity += selectedComboQuantityById.get(comboId) || 0;
                });

                if(buyQuantity < (offer.minQuantity || 1)){
                    throw new apiError(400,`${offer.title} buy quantity requirement is not met`);
                }

                const rewardUnitPrices = [];
                rewardItemIds.forEach((shopItemId)=>{
                    const quantity = selectedItemQuantityById.get(shopItemId) || 0;
                    const unitPrice = selectedItemUnitPriceById.get(shopItemId) || 0;
                    for(let index = 0; index < quantity; index += 1) rewardUnitPrices.push(unitPrice);
                });
                rewardComboIds.forEach((comboId)=>{
                    const quantity = selectedComboQuantityById.get(comboId) || 0;
                    const unitPrice = selectedComboUnitPriceById.get(comboId) || 0;
                    for(let index = 0; index < quantity; index += 1) rewardUnitPrices.push(unitPrice);
                });

                rewardUnitPrices.sort((firstPrice,secondPrice)=>firstPrice - secondPrice);
                currentOfferDiscount = rewardUnitPrices.slice(0,offer.rewardQuantity || 1).reduce((total,price)=>total + price,0);
            }else if(offer.offerType === "FREE_DELIVERY"){
                currentDeliveryDiscount = normalizedDeliveryAmount;
            }else if(offer.discountType === "PERCENTAGE"){
                currentOfferDiscount = Math.round(targetAmount * Number(offer.discountValue || 0) / 100);
            }else if(offer.discountType === "FLAT"){
                currentOfferDiscount = Math.min(Math.round(Number(offer.discountValue || 0)),targetAmount);
            }else if(offer.discountType === "FREE"){
                currentOfferDiscount = targetAmount;
            }else{
                throw new apiError(400,`${offer.title} has no usable discount configuration`);
            }

            if(offer.maxDiscountAmount !== null && offer.maxDiscountAmount !== undefined && currentOfferDiscount > offer.maxDiscountAmount){
                currentOfferDiscount = offer.maxDiscountAmount;
            }

            currentOfferDiscount = Math.min(currentOfferDiscount,Math.max(subtotalAmount - discountAmount,0));
            currentDeliveryDiscount = Math.min(currentDeliveryDiscount,Math.max(normalizedDeliveryAmount - deliveryDiscountAmount,0));

            discountAmount += currentOfferDiscount;
            deliveryDiscountAmount += currentDeliveryDiscount;
            appliedOffers.push({
                id:offer.id,
                title:offer.title,
                discountAmount:currentOfferDiscount,
                deliveryDiscountAmount:currentDeliveryDiscount
            });
        }
    }

    const normalizedPaymentReceived = paymentReceived === undefined || paymentReceived === null
        ? false
        : paymentReceived === true || String(paymentReceived).toLowerCase() === "true";
    const totalAmount = Math.max(0,subtotalAmount - discountAmount + normalizedDeliveryAmount - deliveryDiscountAmount);

    const order = await prisma.order.create({
        data:{
            userId:currentUser.id,
            shopId:shop.id,
            currentOrderStatus:"NEW",
            paymentMethod:normalizedPaymentMethod,
            paymentReceived:normalizedPaymentReceived,
            subtotalAmount,
            discountAmount,
            deliveryAmount:normalizedDeliveryAmount,
            deliveryDiscountAmount,
            totalAmount,
            paidAmount:normalizedPaymentReceived ? totalAmount : 0,
            customerNote:customerNote || undefined,
            orderItems:{
                create:orderItemsToCreate
            }
        },
        include:orderResponseInclude
    });

    return res.status(201).json(new apiResponse(201,{
        ...order,
        appliedOffers
    },"order created successfully"));
});

const getMyOrders = asyncHandler(async(req,res)=>{
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

    const orders = await prisma.order.findMany({
        where:{
            userId:currentUser.id
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            },
            orderItems:{
                select:{
                    id:true,
                    orderItemType:true,
                    shopItemId:true,
                    comboId:true,
                    name:true,
                    quantity:true,
                    priceAtOrderTime:true,
                    totalPrice:true
                }
            }
        },
        orderBy:{
            createdAt:"desc"
        }
    });

    return res.status(200).json(new apiResponse(200,orders,"orders fetched successfully"));
});

const getSellerOrders = asyncHandler(async(req,res)=>{
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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const orders = await prisma.order.findMany({
        where:{
            shop:{
                ownerId:currentUser.id
            },
            currentOrderStatus:{
                in:["NEW","PREPARING","READY"]
            }
        },
        include:{
            user:{
                select:{
                    id:true,
                    name:true,
                    phone:true
                }
            },
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            },
            orderItems:{
                select:{
                    id:true,
                    orderItemType:true,
                    shopItemId:true,
                    comboId:true,
                    name:true,
                    quantity:true,
                    priceAtOrderTime:true,
                    totalPrice:true
                }
            }
        },
        orderBy:{
            createdAt:"asc"
        }
    });

    return res.status(200).json(new apiResponse(200,orders,"seller active orders fetched successfully"));
});

const getSellerProcessedOrders = asyncHandler(async(req,res)=>{
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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const orders = await prisma.order.findMany({
        where:{
            shop:{
                ownerId:currentUser.id
            },
            currentOrderStatus:"DONE"
        },
        include:{
            user:{
                select:{
                    id:true,
                    name:true,
                    phone:true
                }
            },
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            },
            orderItems:{
                select:{
                    id:true,
                    orderItemType:true,
                    shopItemId:true,
                    comboId:true,
                    name:true,
                    quantity:true,
                    priceAtOrderTime:true,
                    totalPrice:true
                }
            }
        },
        orderBy:{
            updatedAt:"desc"
        }
    });

    return res.status(200).json(new apiResponse(200,orders,"seller processed orders fetched successfully"));
});

const getAllProcessedOrders = asyncHandler(async(req,res)=>{
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
    if(currentUser.role !== "ADMIN") throw new apiError(403,"Admin access required");

    const orders = await prisma.order.findMany({
        where:{
            currentOrderStatus:"DONE"
        },
        include:{
            user:{
                select:{
                    id:true,
                    name:true,
                    phone:true
                }
            },
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true,
                    owner:{
                        select:{
                            id:true,
                            name:true,
                            phone:true
                        }
                    }
                }
            },
            orderItems:{
                select:{
                    id:true,
                    orderItemType:true,
                    shopItemId:true,
                    comboId:true,
                    name:true,
                    quantity:true,
                    priceAtOrderTime:true,
                    totalPrice:true
                }
            }
        },
        orderBy:{
            updatedAt:"desc"
        }
    });

    return res.status(200).json(new apiResponse(200,orders,"all processed orders fetched successfully"));
});

const markPaymentReceived = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    if(!orderId) throw new apiError(400,"order id is required");

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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            }
        }
    });

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
    if(order.currentOrderStatus === "DONE" || order.currentOrderStatus === "CANCELLED"){
        throw new apiError(400,"completed or cancelled orders cannot be updated");
    }

    const updatedOrder = await prisma.order.update({
        where:{
            id:order.id
        },
        data:{
            paymentReceived:true,
            paidAmount:order.totalAmount
        },
        include:orderResponseInclude
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"payment marked received successfully"));
});

const confirmOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    if(!orderId) throw new apiError(400,"order id is required");

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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:orderInventoryInclude
    });

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
    if(order.currentOrderStatus !== "NEW") throw new apiError(400,"only new orders can be confirmed");

    const {shopItemUsage,comboUsage} = getOrderInventoryUsage(order);

    const updatedOrder = await prisma.$transaction(async(tx)=>{
        for(const usage of shopItemUsage){
            if(usage.availableQuantity === null) continue;

            const updatedShopItems = await tx.shopItem.updateMany({
                where:{
                    id:usage.id,
                    availableQuantity:{
                        gte:usage.quantity
                    }
                },
                data:{
                    availableQuantity:{
                        decrement:usage.quantity
                    }
                }
            });

            if(updatedShopItems.count !== 1){
                throw new apiError(400,`${usage.name} does not have enough quantity`);
            }
        }

        for(const usage of comboUsage){
            if(usage.availableQuantity === null) continue;

            const updatedCombos = await tx.combo.updateMany({
                where:{
                    id:usage.id,
                    availableQuantity:{
                        gte:usage.quantity
                    }
                },
                data:{
                    availableQuantity:{
                        decrement:usage.quantity
                    }
                }
            });

            if(updatedCombos.count !== 1){
                throw new apiError(400,`${usage.name} does not have enough quantity`);
            }
        }

        return tx.order.update({
            where:{
                id:order.id
            },
            data:{
                currentOrderStatus:"PREPARING"
            },
            include:orderResponseInclude
        });
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order confirmed successfully"));
});

const markOrderReady = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    if(!orderId) throw new apiError(400,"order id is required");

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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            }
        }
    });

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
    if(order.currentOrderStatus !== "PREPARING") throw new apiError(400,"only preparing orders can be marked ready");

    const updatedOrder = await prisma.order.update({
        where:{
            id:order.id
        },
        data:{
            currentOrderStatus:"READY"
        },
        include:orderResponseInclude
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order marked ready successfully"));
});

const markOrderComplete = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    if(!orderId) throw new apiError(400,"order id is required");

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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            }
        }
    });

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
    if(order.currentOrderStatus !== "READY") throw new apiError(400,"only ready orders can be completed");

    const completedAt = new Date();
    const dailyPeriodDate = new Date(completedAt.getFullYear(),completedAt.getMonth(),completedAt.getDate());
    const monthlyPeriodDate = new Date(completedAt.getFullYear(),completedAt.getMonth(),1);
    const yearlyPeriodDate = new Date(completedAt.getFullYear(),0,1);
    const finalPaidAmount = order.paidAmount > 0 ? order.paidAmount : order.totalAmount;
    const deliveryRevenue = Math.max((order.deliveryAmount || 0) - (order.deliveryDiscountAmount || 0),0);

    const updatedOrder = await prisma.$transaction(async(tx)=>{
        const completedOrder = await tx.order.update({
            where:{
                id:order.id
            },
            data:{
                currentOrderStatus:"DONE",
                paymentReceived:true,
                paidAmount:finalPaidAmount,
                completedAt
            },
            include:orderResponseInclude
        });

        for(const periodData of [
            { periodType:"DAILY", periodDate:dailyPeriodDate },
            { periodType:"MONTHLY", periodDate:monthlyPeriodDate },
            { periodType:"YEARLY", periodDate:yearlyPeriodDate }
        ]){
            await tx.shopRevenueSummary.upsert({
                where:{
                    shopId_periodType_periodDate:{
                        shopId:order.shop.id,
                        periodType:periodData.periodType,
                        periodDate:periodData.periodDate
                    }
                },
                update:{
                    successfulOrders:{
                        increment:1
                    },
                    grossRevenue:{
                        increment:order.totalAmount
                    },
                    discountAmount:{
                        increment:order.discountAmount + order.deliveryDiscountAmount
                    },
                    deliveryRevenue:{
                        increment:deliveryRevenue
                    },
                    netRevenue:{
                        increment:finalPaidAmount - order.refundAmount
                    }
                },
                create:{
                    shopId:order.shop.id,
                    periodType:periodData.periodType,
                    periodDate:periodData.periodDate,
                    successfulOrders:1,
                    grossRevenue:order.totalAmount,
                    discountAmount:order.discountAmount + order.deliveryDiscountAmount,
                    deliveryRevenue,
                    refundAmount:0,
                    netRevenue:finalPaidAmount - order.refundAmount
                }
            });
        }

        await tx.buyerCompletedOffer.upsert({
            where:{
                orderId:order.id
            },
            update:{
                buyerId:order.userId,
                shopId:order.shop.id,
                totalAmount:order.totalAmount,
                completedAt:new Date()
            },
            create:{
                buyerId:order.userId,
                shopId:order.shop.id,
                orderId:order.id,
                totalAmount:order.totalAmount
            }
        });

        return completedOrder;
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order completed successfully"));
});

const cancelOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;
    const { refundAmount } = req.body;

    if(!orderId) throw new apiError(400,"order id is required");

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

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:orderInventoryInclude
    });

    if(!order) throw new apiError(404,"order not found");

    const isBuyerOwner = currentUser.role === "BUYER" && order.userId === currentUser.id;
    const isSellerOwner = currentUser.role === "SELLER" && order.shop?.ownerId === currentUser.id;
    const isAdmin = currentUser.role === "ADMIN";

    if(!isBuyerOwner && !isSellerOwner && !isAdmin){
        throw new apiError(403,"You cannot cancel this order");
    }

    if(order.currentOrderStatus === "DONE" || order.currentOrderStatus === "CANCELLED"){
        throw new apiError(400,"completed or cancelled orders cannot be cancelled");
    }

    const normalizedRefundAmount = refundAmount === undefined || refundAmount === null || refundAmount === ""
        ? 0
        : Number(refundAmount);

    if(!Number.isInteger(normalizedRefundAmount) || normalizedRefundAmount < 0){
        throw new apiError(400,"refundAmount must be a valid number");
    }

    const shouldRestoreInventory = order.currentOrderStatus === "PREPARING" || order.currentOrderStatus === "READY";
    const {shopItemUsage,comboUsage} = getOrderInventoryUsage(order);
    const cancelledAt = new Date();
    const dailyPeriodDate = new Date(cancelledAt.getFullYear(),cancelledAt.getMonth(),cancelledAt.getDate());
    const monthlyPeriodDate = new Date(cancelledAt.getFullYear(),cancelledAt.getMonth(),1);
    const yearlyPeriodDate = new Date(cancelledAt.getFullYear(),0,1);

    const updatedOrder = await prisma.$transaction(async(tx)=>{
        if(shouldRestoreInventory){
            for(const usage of shopItemUsage){
                await tx.shopItem.updateMany({
                    where:{
                        id:usage.id,
                        availableQuantity:{
                            not:null
                        }
                    },
                    data:{
                        availableQuantity:{
                            increment:usage.quantity
                        }
                    }
                });
            }

            for(const usage of comboUsage){
                await tx.combo.updateMany({
                    where:{
                        id:usage.id,
                        availableQuantity:{
                            not:null
                        }
                    },
                    data:{
                        availableQuantity:{
                            increment:usage.quantity
                        }
                    }
                });
            }
        }

        const cancelledOrder = await tx.order.update({
            where:{
                id:order.id
            },
            data:{
                currentOrderStatus:"CANCELLED",
                refundAmount:normalizedRefundAmount,
                cancelledAt,
                refundedAt:normalizedRefundAmount > 0 ? cancelledAt : null
            },
            include:orderResponseInclude
        });

        for(const periodData of [
            { periodType:"DAILY", periodDate:dailyPeriodDate },
            { periodType:"MONTHLY", periodDate:monthlyPeriodDate },
            { periodType:"YEARLY", periodDate:yearlyPeriodDate }
        ]){
            await tx.shopRevenueSummary.upsert({
                where:{
                    shopId_periodType_periodDate:{
                        shopId:order.shop.id,
                        periodType:periodData.periodType,
                        periodDate:periodData.periodDate
                    }
                },
                update:{
                    cancelledOrders:{
                        increment:1
                    },
                    refundAmount:{
                        increment:normalizedRefundAmount
                    }
                },
                create:{
                    shopId:order.shop.id,
                    periodType:periodData.periodType,
                    periodDate:periodData.periodDate,
                    successfulOrders:0,
                    cancelledOrders:1,
                    grossRevenue:0,
                    discountAmount:0,
                    deliveryRevenue:0,
                    refundAmount:normalizedRefundAmount,
                    netRevenue:0
                }
            });
        }

        return cancelledOrder;
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order cancelled successfully"));
});

const refundCompletedOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    if(!orderId) throw new apiError(400,"order id is required");

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
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    const order = await prisma.order.findUnique({
        where:{
            id:orderId
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            }
        }
    });

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only refund orders for your own shop");
    if(order.currentOrderStatus !== "DONE") throw new apiError(400,"only completed orders can be refunded");

    const paidAmount = order.paidAmount > 0 ? order.paidAmount : order.totalAmount;
    const normalizedRefundAmount = paidAmount - order.refundAmount;

    if(normalizedRefundAmount <= 0){
        throw new apiError(400,"order is already fully refunded");
    }

    const refundedAt = new Date();
    const dailyPeriodDate = new Date(refundedAt.getFullYear(),refundedAt.getMonth(),refundedAt.getDate());
    const monthlyPeriodDate = new Date(refundedAt.getFullYear(),refundedAt.getMonth(),1);
    const yearlyPeriodDate = new Date(refundedAt.getFullYear(),0,1);

    const updatedOrder = await prisma.$transaction(async(tx)=>{
        const refundedOrder = await tx.order.update({
            where:{
                id:order.id
            },
            data:{
                refundAmount:{
                    increment:normalizedRefundAmount
                },
                refundedAt
            },
            include:orderResponseInclude
        });

        for(const periodData of [
            { periodType:"DAILY", periodDate:dailyPeriodDate },
            { periodType:"MONTHLY", periodDate:monthlyPeriodDate },
            { periodType:"YEARLY", periodDate:yearlyPeriodDate }
        ]){
            await tx.shopRevenueSummary.upsert({
                where:{
                    shopId_periodType_periodDate:{
                        shopId:order.shop.id,
                        periodType:periodData.periodType,
                        periodDate:periodData.periodDate
                    }
                },
                update:{
                    refundAmount:{
                        increment:normalizedRefundAmount
                    },
                    netRevenue:{
                        decrement:normalizedRefundAmount
                    }
                },
                create:{
                    shopId:order.shop.id,
                    periodType:periodData.periodType,
                    periodDate:periodData.periodDate,
                    successfulOrders:0,
                    cancelledOrders:0,
                    grossRevenue:0,
                    discountAmount:0,
                    deliveryRevenue:0,
                    refundAmount:normalizedRefundAmount,
                    netRevenue:-normalizedRefundAmount
                }
            });
        }

        return refundedOrder;
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order refund recorded successfully"));
});

export {
    createOrder,
    getMyOrders,
    getSellerOrders,
    getSellerProcessedOrders,
    getAllProcessedOrders,
    markPaymentReceived,
    confirmOrder,
    markOrderReady,
    markOrderComplete,
    cancelOrder,
    refundCompletedOrder
};
