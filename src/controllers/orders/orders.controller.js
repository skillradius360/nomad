import { prisma } from "../../db/index.js";
import { asyncHandler, apiError, apiResponse } from "../../utils/handler.js";

const VALID_PAYMENT_METHODS = ["CASH","CARD","UPI"];

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
        comboIds
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

    const normalizedPaymentReceived = paymentReceived === undefined || paymentReceived === null
        ? false
        : paymentReceived === true || String(paymentReceived).toLowerCase() === "true";

    const order = await prisma.$transaction(async(tx)=>{
        for(const usage of shopItemQuantityUsage.values()){
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

        for(const selectedCombo of normalizedCombos){
            const combo = combosData.find((currentCombo)=>currentCombo.id === String(selectedCombo.comboId));
            if(combo.availableQuantity === null) continue;

            const updatedCombos = await tx.combo.updateMany({
                where:{
                    id:combo.id,
                    availableQuantity:{
                        gte:selectedCombo.quantity
                    }
                },
                data:{
                    availableQuantity:{
                        decrement:selectedCombo.quantity
                    }
                }
            });

            if(updatedCombos.count !== 1){
                throw new apiError(400,`${combo.name} does not have enough quantity`);
            }
        }

        return tx.order.create({
            data:{
                userId:currentUser.id,
                shopId:shop.id,
                currentOrderStatus:"NEW",
                paymentMethod:normalizedPaymentMethod,
                paymentReceived:normalizedPaymentReceived,
                subtotalAmount,
                deliveryAmount:normalizedDeliveryAmount,
                totalAmount:subtotalAmount + normalizedDeliveryAmount,
                customerNote:customerNote || undefined,
                orderItems:{
                    create:orderItemsToCreate
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
                    include:{
                        shopItem:{
                            include:{
                                item:true
                            }
                        },
                        combo:true
                    }
                }
            }
        });
    });

    return res.status(201).json(new apiResponse(201,order,"order created successfully"));
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
            orderItems:true
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
            orderItems:true
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
            orderItems:true
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
            orderItems:true
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
            paymentReceived:true
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
            orderItems:true
        }
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
    if(order.currentOrderStatus !== "NEW") throw new apiError(400,"only new orders can be confirmed");

    const updatedOrder = await prisma.order.update({
        where:{
            id:order.id
        },
        data:{
            currentOrderStatus:"PREPARING"
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
            orderItems:true
        }
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
            orderItems:true
        }
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

    const updatedOrder = await prisma.order.update({
        where:{
            id:order.id
        },
        data:{
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
            orderItems:true
        }
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order completed successfully"));
});

const cancelOrder = asyncHandler(async(req,res)=>{
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

    const isBuyerOwner = currentUser.role === "BUYER" && order.userId === currentUser.id;
    const isSellerOwner = currentUser.role === "SELLER" && order.shop?.ownerId === currentUser.id;
    const isAdmin = currentUser.role === "ADMIN";

    if(!isBuyerOwner && !isSellerOwner && !isAdmin){
        throw new apiError(403,"You cannot cancel this order");
    }

    if(order.currentOrderStatus === "DONE" || order.currentOrderStatus === "CANCELLED"){
        throw new apiError(400,"completed or cancelled orders cannot be cancelled");
    }

    const updatedOrder = await prisma.order.update({
        where:{
            id:order.id
        },
        data:{
            currentOrderStatus:"CANCELLED"
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
            orderItems:true
        }
    });

    return res.status(200).json(new apiResponse(200,updatedOrder,"order cancelled successfully"));
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
    cancelOrder
};
