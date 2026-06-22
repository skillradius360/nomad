import { prisma } from "../../db/index.js";
import { asyncHandler, apiError, apiResponse } from "../../utils/handler.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { randomUUID } from "node:crypto";
import { calculateBpsAmount, getBillingSettings } from "../../utils/billing.js";

const VALID_PAYMENT_METHODS = ["CASH","CARD","UPI"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireValidOrderId = (orderId)=>{
    if(typeof orderId !== "string" || !UUID_PATTERN.test(orderId)){
        throw new apiError(400,"valid order id is required");
    }
};

const serializeInventoryUsage = (rows)=>JSON.stringify(rows.map((row)=>(
    {
        id:String(row.id),
        quantity:Number(row.quantity)
    }
)));

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

const orderItemSelect = {
    id:true,
    orderItemType:true,
    shopItemId:true,
    comboId:true,
    name:true,
    quantity:true,
    priceAtOrderTime:true,
    totalPrice:true
};

const orderListSelect = {
    id:true,
    shopId:true,
    currentOrderStatus:true,
    paymentMethod:true,
    paymentReceived:true,
    subtotalAmount:true,
    discountAmount:true,
    deliveryAmount:true,
    deliveryDiscountAmount:true,
    totalAmount:true,
    customerNote:true,
    createdAt:true,
    shop:{
        select:{
            id:true,
            shopName:true
        }
    },
    orderItems:{
        select:orderItemSelect
    }
};

const sellerOrderListSelect = {
    ...orderListSelect,
    user:{
        select:{
            id:true,
            name:true,
            phone:true
        }
    }
};

const createdOrderSelect = {
    id:true,
    currentOrderStatus:true,
    paymentMethod:true,
    paymentReceived:true,
    subtotalAmount:true,
    discountAmount:true,
    deliveryAmount:true,
    deliveryDiscountAmount:true,
    totalAmount:true,
    customerNote:true,
    createdAt:true,
    orderItems:{
        select:orderItemSelect
    }
};

const orderMutationSelect = {
    id:true,
    currentOrderStatus:true,
    paymentReceived:true,
    paidAmount:true,
    refundAmount:true
};

const applyRevenueDeltas = async(tx,rows)=>{
    if(rows.length === 0) return;

    const revenueRows = rows.map((row)=>({
        id:randomUUID(),
        shopId:String(row.shopId),
        periodType:String(row.periodType),
        periodDate:row.periodDate.toISOString(),
        successfulOrders:Number(row.successfulOrders),
        cancelledOrders:Number(row.cancelledOrders),
        grossRevenue:Number(row.grossRevenue),
        discountAmount:Number(row.discountAmount),
        deliveryRevenue:Number(row.deliveryRevenue),
        refundAmount:Number(row.refundAmount),
        netRevenue:Number(row.netRevenue)
    }));

    await tx.$executeRaw`
        INSERT INTO "ShopRevenueSummary" (
            "id","shopId","periodType","periodDate","successfulOrders","cancelledOrders",
            "grossRevenue","discountAmount","deliveryRevenue","refundAmount","netRevenue","updatedAt"
        )
        SELECT
            revenue."id",
            revenue."shopId",
            revenue."periodType"::"RevenuePeriodType",
            (revenue."periodDate"::timestamptz AT TIME ZONE 'UTC'),
            revenue."successfulOrders",
            revenue."cancelledOrders",
            revenue."grossRevenue",
            revenue."discountAmount",
            revenue."deliveryRevenue",
            revenue."refundAmount",
            revenue."netRevenue",
            CURRENT_TIMESTAMP
        FROM jsonb_to_recordset(${JSON.stringify(revenueRows)}::jsonb) AS revenue(
            "id" text,
            "shopId" text,
            "periodType" text,
            "periodDate" text,
            "successfulOrders" integer,
            "cancelledOrders" integer,
            "grossRevenue" integer,
            "discountAmount" integer,
            "deliveryRevenue" integer,
            "refundAmount" integer,
            "netRevenue" integer
        )
        ON CONFLICT ("shopId","periodType","periodDate") DO UPDATE SET
            "successfulOrders" = "ShopRevenueSummary"."successfulOrders" + EXCLUDED."successfulOrders",
            "cancelledOrders" = "ShopRevenueSummary"."cancelledOrders" + EXCLUDED."cancelledOrders",
            "grossRevenue" = "ShopRevenueSummary"."grossRevenue" + EXCLUDED."grossRevenue",
            "discountAmount" = "ShopRevenueSummary"."discountAmount" + EXCLUDED."discountAmount",
            "deliveryRevenue" = "ShopRevenueSummary"."deliveryRevenue" + EXCLUDED."deliveryRevenue",
            "refundAmount" = "ShopRevenueSummary"."refundAmount" + EXCLUDED."refundAmount",
            "netRevenue" = "ShopRevenueSummary"."netRevenue" + EXCLUDED."netRevenue",
            "updatedAt" = CURRENT_TIMESTAMP
    `;
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

const groupOfferSelections = (selections,idKey)=>selections.reduce((groups,selection)=>{
    groups[selection.role]?.push(selection[idKey]);
    return groups;
},{
    APPLIES_TO:[],
    CUSTOMER_BUYS:[],
    CUSTOMER_GETS:[]
});

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

const formatOrderListItem = (order)=>({
    id:order.id,
    ...(order.user ? {
        buyer:{
            id:order.user.id,
            name:order.user.name,
            phone:order.user.phone
        }
    } : {}),
    shopId:order.shopId,
    shopName:order.shop?.shopName || null,
    currentOrderStatus:order.currentOrderStatus,
    paymentMethod:order.paymentMethod,
    paymentReceived:order.paymentReceived,
    subtotalAmount:order.subtotalAmount,
    discountAmount:order.discountAmount,
    deliveryAmount:order.deliveryAmount,
    deliveryDiscountAmount:order.deliveryDiscountAmount,
    totalAmount:order.totalAmount,
    customerNote:order.customerNote,
    createdAt:order.createdAt,
    items:order.orderItems?.map((item)=>({
        id:item.id,
        type:item.orderItemType,
        itemId:item.shopItemId || item.comboId,
        shopItemId:item.shopItemId,
        comboId:item.comboId,
        name:item.name,
        quantity:item.quantity,
        price:item.priceAtOrderTime,
        totalPrice:item.totalPrice
    })) || []
});

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

    const rawOfferInput = appliedOfferIds ?? offerIds ?? offerId;
    let selectedOfferIds = [];
    if(Array.isArray(rawOfferInput)){
        selectedOfferIds = rawOfferInput.map(String).filter(Boolean);
    }else if(typeof rawOfferInput === "string" && rawOfferInput.trim()){
        const trimmedOfferInput = rawOfferInput.trim();
        if(trimmedOfferInput.startsWith("[")){
            try{
                const parsedOfferIds = JSON.parse(trimmedOfferInput);
                if(!Array.isArray(parsedOfferIds)) throw new Error("offer ids must be an array");
                selectedOfferIds = parsedOfferIds.map(String).filter(Boolean);
            }catch{
                throw new apiError(400,"offer ids must be a valid JSON array");
            }
        }else{
            selectedOfferIds = [trimmedOfferInput];
        }
    }else if(rawOfferInput){
        selectedOfferIds = [String(rawOfferInput)];
    }

    if(new Set(selectedOfferIds).size !== selectedOfferIds.length){
        throw new apiError(400,"duplicate offer ids are not allowed");
    }

    const now = new Date();
    const [currentUser,shop,shopItemsData,combosData,offersData,completedOffer] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                name:true,
                phone:true,
                role:true,
                billingPlan:true,
                isBlocked:true
            }
        }),
        prisma.shop.findUnique({
            where:{
                id:shopId
            },
            select:{
                id:true,
                shopName:true,
                ownerId:true,
                ShopOpenStatus:true,
                Verified:true,
                billingStatus:true
            }
        }),
        uniqueShopItemIds.length > 0
            ? prisma.shopItem.findMany({
                where:{
                    id:{
                        in:uniqueShopItemIds
                    },
                    shopId,
                    active:true
                },
                select:{
                    id:true,
                    pricing:true,
                    availableQuantity:true,
                    item:{
                        select:{
                            id:true,
                            name:true
                        }
                    }
                }
            })
            : Promise.resolve([]),
        uniqueComboIds.length > 0
            ? prisma.combo.findMany({
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
            : Promise.resolve([]),
        selectedOfferIds.length > 0
            ? prisma.offer.findMany({
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
                select:{
                    id:true,
                    title:true,
                    offerType:true,
                    applyTo:true,
                    audienceType:true,
                    stackingMode:true,
                    minQuantity:true,
                    minOrderAmount:true,
                    discountType:true,
                    discountValue:true,
                    maxDiscountAmount:true,
                    rewardQuantity:true,
                    items:{
                        select:{
                            shopItemId:true,
                            role:true
                        }
                    },
                    combos:{
                        select:{
                            comboId:true,
                            role:true
                        }
                    },
                    buyers:{
                        select:{
                            buyerId:true
                        }
                    }
                }
            })
            : Promise.resolve([]),
        selectedOfferIds.length > 0
            ? prisma.buyerCompletedOffer.findFirst({
                where:{
                    buyerId:req.userData?.id,
                    shopId
                },
                select:{
                    id:true
                }
            })
            : Promise.resolve(null)
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "BUYER") throw new apiError(403,"Buyer access required");
    if(!shop) throw new apiError(404,"shop not found");
    if(shop.billingStatus === "HOLD" || shop.billingStatus === "PAYMENT_DUE"){
        throw new apiError(402,"shop ordering is temporarily unavailable while billing is on hold");
    }

    if(shopItemsData.length !== uniqueShopItemIds.length){
        throw new apiError(400,"one or more items are invalid for this shop");
    }

    if(combosData.length !== uniqueComboIds.length){
        throw new apiError(400,"one or more combos are invalid for this shop");
    }

    const shopItemsById = new Map(shopItemsData.map((item)=>[item.id,item]));
    const combosById = new Map(combosData.map((combo)=>[combo.id,combo]));
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
        const shopItem = shopItemsById.get(String(selectedItem.shopItemId));
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
        const combo = combosById.get(String(selectedCombo.comboId));
        const comboPrice = Number(combo.totalPrice);

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
        if(offersData.length !== selectedOfferIds.length){
            throw new apiError(400,"one or more offers are invalid or inactive for this shop");
        }

        if(selectedOfferIds.length > 1 && offersData.some((offer)=>offer.stackingMode !== "STACKABLE")){
            throw new apiError(400,"exclusive offers cannot be combined");
        }

        for(const offer of offersData){
            const offerItemIds = groupOfferSelections(offer.items,"shopItemId");
            const offerComboIds = groupOfferSelections(offer.combos,"comboId");
            const appliesToItemIds = offerItemIds.APPLIES_TO;
            const buyItemIds = offerItemIds.CUSTOMER_BUYS;
            const rewardItemIds = offerItemIds.CUSTOMER_GETS;
            const appliesToComboIds = offerComboIds.APPLIES_TO;
            const buyComboIds = offerComboIds.CUSTOMER_BUYS;
            const rewardComboIds = offerComboIds.CUSTOMER_GETS;

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
        select:createdOrderSelect
    });

    return res.status(201).json(new apiResponse(201,{
        id:order.id,
        shopId:shop.id,
        shopName:shop.shopName,
        currentOrderStatus:order.currentOrderStatus,
        paymentMethod:order.paymentMethod,
        paymentReceived:order.paymentReceived,
        subtotalAmount:order.subtotalAmount,
        discountAmount:order.discountAmount,
        deliveryAmount:order.deliveryAmount,
        deliveryDiscountAmount:order.deliveryDiscountAmount,
        totalAmount:order.totalAmount,
        customerNote:order.customerNote,
        createdAt:order.createdAt,
        items:order.orderItems.map((item)=>(
            {
                id:item.id,
                type:item.orderItemType,
                itemId:item.shopItemId || item.comboId,
                name:item.name,
                quantity:item.quantity,
                price:item.priceAtOrderTime,
                totalPrice:item.totalPrice
            }
        )),
        appliedOffers
    },"order created successfully"));
});

const getMyOrders = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query);
    const where = {
        userId:req.userData?.id
    };

    const [currentUser,orders,total] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findMany({
            where,
            select:orderListSelect,
            orderBy:{
                createdAt:"desc"
            },
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.order.count({ where })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        orders:orders.map(formatOrderListItem)
    },"orders fetched successfully"));
});

const getSellerOrders = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query);
    const where = {
        shop:{
            ownerId:req.userData?.id
        },
        currentOrderStatus:{
            in:["NEW","PREPARING","READY"]
        }
    };

    const [currentUser,orders,total] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findMany({
            where,
            select:sellerOrderListSelect,
            orderBy:{
                createdAt:"asc"
            },
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.order.count({ where })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        orders:orders.map(formatOrderListItem)
    },"seller active orders fetched successfully"));
});

const getSellerProcessedOrders = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query);
    const where = {
        shop:{
            ownerId:req.userData?.id
        },
        currentOrderStatus:"DONE"
    };

    const [currentUser,orders,total] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findMany({
            where,
            select:sellerOrderListSelect,
            orderBy:{
                updatedAt:"desc"
            },
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.order.count({ where })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        orders:orders.map(formatOrderListItem)
    },"seller processed orders fetched successfully"));
});

const getOrderCurrentStatus = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    const [currentUser,order] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findUnique({
            where:{
                id:orderId
            },
            select:{
                id:true,
                userId:true,
                currentOrderStatus:true,
                paymentReceived:true,
                shop:{
                    select:{
                        ownerId:true
                    }
                }
            }
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    if(!order) throw new apiError(404,"order not found");

    const canViewOrder =
        currentUser.role === "ADMIN" ||
        order.userId === currentUser.id ||
        order.shop?.ownerId === currentUser.id;

    if(!canViewOrder) throw new apiError(403,"You cannot view this order");

    const normalFlow = ["NEW","PAYMENT_DONE","PREPARING","READY","DONE"];
    const currentStatusIndex = normalFlow.indexOf(order.currentOrderStatus);
    const completed = [];

    if(order.currentOrderStatus === "CANCELLED"){
        completed.push("NEW");
        if(order.paymentReceived) completed.push("PAYMENT_DONE");
        completed.push("CANCELLED");
    }else{
        normalFlow.forEach((status,index)=>{
            if(status === "PAYMENT_DONE"){
                if(order.paymentReceived) completed.push(status);
                return;
            }

            if(currentStatusIndex !== -1 && index < currentStatusIndex){
                completed.push(status);
            }
        });
    }

    return res.status(200).json(new apiResponse(200,{
        completed,
        currentStatus:order.currentOrderStatus
    },"order current status fetched successfully"));
});

const getAllProcessedOrders = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query);
    const where = {
        currentOrderStatus:"DONE"
    };

    const [currentUser,orders,total] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findMany({
            where,
            select:sellerOrderListSelect,
            orderBy:{
                updatedAt:"desc"
            },
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.order.count({ where })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "ADMIN") throw new apiError(403,"Admin access required");

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        orders:orders.map(formatOrderListItem)
    },"all processed orders fetched successfully"));
});

const markPaymentReceived = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    const updatedOrders = await prisma.$queryRaw`
        WITH updated_order AS (
            UPDATE "Order" AS orders
            SET
                "paymentReceived" = TRUE,
                "paidAmount" = orders."totalAmount",
                "updatedAt" = CURRENT_TIMESTAMP
            FROM "Shop" AS shops
            JOIN "User" AS owners ON owners."id" = shops."ownerId"
            WHERE orders."id" = ${orderId}
              AND orders."shopId" = shops."id"
              AND shops."ownerId" = ${req.userData?.id}
              AND owners."role" = 'SELLER'
              AND owners."isBlocked" = FALSE
              AND orders."currentOrderStatus" NOT IN ('DONE','CANCELLED')
            RETURNING
                orders."id",
                orders."currentOrderStatus",
                orders."paymentReceived",
                orders."paidAmount",
                orders."refundAmount"
        )
        SELECT * FROM updated_order
    `;

    if(updatedOrders.length === 0){
        const [currentUser,order] = await Promise.all([
            prisma.user.findUnique({
                where:{
                    id:req.userData?.id
                },
                select:{
                    id:true,
                    role:true,
                    isBlocked:true
                }
            }),
            prisma.order.findUnique({
                where:{
                    id:orderId
                },
                select:{
                    currentOrderStatus:true,
                    shop:{
                        select:{
                            ownerId:true
                        }
                    }
                }
            })
        ]);

        if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
        if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");
        if(!order) throw new apiError(404,"order not found");
        if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
        throw new apiError(400,"completed or cancelled orders cannot be updated");
    }

    const updatedOrder = updatedOrders[0];

    return res.status(200).json(new apiResponse(200,updatedOrder,"payment marked received successfully"));
});

const confirmOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    const [currentUser,order] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findUnique({
            where:{
                id:orderId
            },
            include:orderInventoryInclude
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

    if(!order) throw new apiError(404,"order not found");
    if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
    if(order.currentOrderStatus !== "NEW") throw new apiError(400,"only new orders can be confirmed");

    const {shopItemUsage,comboUsage} = getOrderInventoryUsage(order);
    const finiteShopItemUsage = shopItemUsage.filter((usage)=>usage.availableQuantity !== null);
    const finiteComboUsage = comboUsage.filter((usage)=>usage.availableQuantity !== null);

    const updatedOrder = await prisma.$transaction(async(tx)=>{
        const [inventoryResult] = await tx.$queryRaw`
            WITH shop_item_usage AS (
                SELECT *
                FROM jsonb_to_recordset(${serializeInventoryUsage(finiteShopItemUsage)}::jsonb)
                    AS usage("id" text,"quantity" integer)
            ),
            combo_usage AS (
                SELECT *
                FROM jsonb_to_recordset(${serializeInventoryUsage(finiteComboUsage)}::jsonb)
                    AS usage("id" text,"quantity" integer)
            ),
            updated_shop_items AS (
                UPDATE "ShopItem" AS shop_items
                SET
                    "availableQuantity" = shop_items."availableQuantity" - usage."quantity",
                    "updatedAt" = CURRENT_TIMESTAMP
                FROM shop_item_usage AS usage
                WHERE shop_items."id" = usage."id"
                  AND shop_items."availableQuantity" >= usage."quantity"
                RETURNING shop_items."id"
            ),
            updated_combos AS (
                UPDATE "Combo" AS combos
                SET
                    "availableQuantity" = combos."availableQuantity" - usage."quantity",
                    "updatedAt" = CURRENT_TIMESTAMP
                FROM combo_usage AS usage
                WHERE combos."id" = usage."id"
                  AND combos."availableQuantity" >= usage."quantity"
                RETURNING combos."id"
            )
            SELECT
                COALESCE((SELECT jsonb_agg("id") FROM updated_shop_items),'[]'::jsonb) AS "shopItemIds",
                COALESCE((SELECT jsonb_agg("id") FROM updated_combos),'[]'::jsonb) AS "comboIds"
        `;

        const updatedShopItemIds = new Set(inventoryResult.shopItemIds);
        const updatedComboIds = new Set(inventoryResult.comboIds);
        const unavailableShopItem = finiteShopItemUsage.find((usage)=>!updatedShopItemIds.has(usage.id));
        const unavailableCombo = finiteComboUsage.find((usage)=>!updatedComboIds.has(usage.id));

        if(unavailableShopItem) throw new apiError(400,`${unavailableShopItem.name} does not have enough quantity`);
        if(unavailableCombo) throw new apiError(400,`${unavailableCombo.name} does not have enough quantity`);

        return tx.order.update({
            where:{
                id:order.id
            },
            data:{
                currentOrderStatus:"PREPARING"
            },
            select:{
                id:true,
                currentOrderStatus:true
            }
        });
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order confirmed successfully"));
});

const markOrderReady = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    let updatedOrder;

    try{
        updatedOrder = await prisma.order.update({
            where:{
                id:orderId,
                currentOrderStatus:"PREPARING",
                shop:{
                    ownerId:req.userData?.id,
                    owner:{
                        role:"SELLER",
                        isBlocked:false
                    }
                }
            },
            data:{
                currentOrderStatus:"READY"
            },
            select:{
                id:true,
                currentOrderStatus:true
            }
        });
    }catch(error){
        if(error?.code !== "P2025") throw error;

        const [currentUser,order] = await Promise.all([
            prisma.user.findUnique({
                where:{
                    id:req.userData?.id
                },
                select:{
                    id:true,
                    role:true,
                    isBlocked:true
                }
            }),
            prisma.order.findUnique({
                where:{
                    id:orderId
                },
                select:{
                    currentOrderStatus:true,
                    shop:{
                        select:{
                            ownerId:true
                        }
                    }
                }
            })
        ]);

        if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
        if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");
        if(!order) throw new apiError(404,"order not found");
        if(!order.shop || order.shop.ownerId !== currentUser.id) throw new apiError(403,"You can only manage orders for your own shop");
        throw new apiError(400,"only preparing orders can be marked ready");
    }

    return res.status(200).json(new apiResponse(200,updatedOrder,"order marked ready successfully"));
});

const markOrderComplete = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    const [currentUser,order] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findUnique({
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
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

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
        const billingSettings = await getBillingSettings(tx);
        const commissionAmount = calculateBpsAmount(finalPaidAmount,billingSettings.commissionBps);
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
            select:orderMutationSelect
        });

        await applyRevenueDeltas(tx,[dailyPeriodDate,monthlyPeriodDate,yearlyPeriodDate].map((periodDate,index)=>(
            {
                shopId:order.shop.id,
                periodType:["DAILY","MONTHLY","YEARLY"][index],
                periodDate,
                successfulOrders:1,
                cancelledOrders:0,
                grossRevenue:order.totalAmount,
                discountAmount:order.discountAmount + order.deliveryDiscountAmount,
                deliveryRevenue,
                refundAmount:0,
                netRevenue:finalPaidAmount - order.refundAmount
            }
        )));

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

        await tx.orderCommissionCharge.create({
            data:{
                orderId:order.id,
                shopId:order.shop.id,
                orderValue:finalPaidAmount,
                commissionBps:billingSettings.commissionBps,
                commissionAmount,
                completedAt
            }
        });

        return completedOrder;
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order completed successfully"));
});

const cancelOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;
    const { refundAmount } = req.body;

    requireValidOrderId(orderId);

    const [currentUser,order] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                isBlocked:true
            }
        }),
        prisma.order.findUnique({
            where:{
                id:orderId
            },
            include:orderInventoryInclude
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

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
            await tx.$queryRaw`
                WITH shop_item_usage AS (
                    SELECT *
                    FROM jsonb_to_recordset(${serializeInventoryUsage(shopItemUsage)}::jsonb)
                        AS usage("id" text,"quantity" integer)
                ),
                combo_usage AS (
                    SELECT *
                    FROM jsonb_to_recordset(${serializeInventoryUsage(comboUsage)}::jsonb)
                        AS usage("id" text,"quantity" integer)
                ),
                restored_shop_items AS (
                    UPDATE "ShopItem" AS shop_items
                    SET
                        "availableQuantity" = shop_items."availableQuantity" + usage."quantity",
                        "updatedAt" = CURRENT_TIMESTAMP
                    FROM shop_item_usage AS usage
                    WHERE shop_items."id" = usage."id"
                      AND shop_items."availableQuantity" IS NOT NULL
                    RETURNING shop_items."id"
                ),
                restored_combos AS (
                    UPDATE "Combo" AS combos
                    SET
                        "availableQuantity" = combos."availableQuantity" + usage."quantity",
                        "updatedAt" = CURRENT_TIMESTAMP
                    FROM combo_usage AS usage
                    WHERE combos."id" = usage."id"
                      AND combos."availableQuantity" IS NOT NULL
                    RETURNING combos."id"
                )
                SELECT
                    (SELECT count(*) FROM restored_shop_items) AS "shopItemCount",
                    (SELECT count(*) FROM restored_combos) AS "comboCount"
            `;
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
            select:orderMutationSelect
        });

        await applyRevenueDeltas(tx,[dailyPeriodDate,monthlyPeriodDate,yearlyPeriodDate].map((periodDate,index)=>(
            {
                shopId:order.shop.id,
                periodType:["DAILY","MONTHLY","YEARLY"][index],
                periodDate,
                successfulOrders:0,
                cancelledOrders:1,
                grossRevenue:0,
                discountAmount:0,
                deliveryRevenue:0,
                refundAmount:normalizedRefundAmount,
                netRevenue:0
            }
        )));

        return cancelledOrder;
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order cancelled successfully"));
});

const refundCompletedOrder = asyncHandler(async(req,res)=>{
    const { orderId } = req.params;

    requireValidOrderId(orderId);

    const [currentUser,order] = await Promise.all([
        prisma.user.findUnique({
            where:{
                id:req.userData?.id
            },
            select:{
                id:true,
                role:true,
                billingPlan:true,
                isBlocked:true
            }
        }),
        prisma.order.findUnique({
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
        })
    ]);

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(currentUser.role !== "SELLER") throw new apiError(403,"Seller access required");

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
            select:orderMutationSelect
        });

        await applyRevenueDeltas(tx,[dailyPeriodDate,monthlyPeriodDate,yearlyPeriodDate].map((periodDate,index)=>(
            {
                shopId:order.shop.id,
                periodType:["DAILY","MONTHLY","YEARLY"][index],
                periodDate,
                successfulOrders:0,
                cancelledOrders:0,
                grossRevenue:0,
                discountAmount:0,
                deliveryRevenue:0,
                refundAmount:normalizedRefundAmount,
                netRevenue:-normalizedRefundAmount
            }
        )));

        const commissionCharge = await tx.orderCommissionCharge.findUnique({
            where:{orderId:order.id},
            select:{
                id:true,
                commissionAmount:true,
                refundedCommission:true
            }
        });

        if(commissionCharge){
            const commissionAdjustment = Math.max(
                0,
                commissionCharge.commissionAmount - commissionCharge.refundedCommission
            );
            if(commissionAdjustment > 0){
                await tx.orderCommissionCharge.update({
                    where:{id:commissionCharge.id},
                    data:{
                        refundedCommission:{increment:commissionAdjustment},
                        pendingAdjustment:{increment:commissionAdjustment}
                    }
                });
            }
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
    getOrderCurrentStatus,
    getAllProcessedOrders,
    markPaymentReceived,
    confirmOrder,
    markOrderReady,
    markOrderComplete,
    cancelOrder,
    refundCompletedOrder
};
