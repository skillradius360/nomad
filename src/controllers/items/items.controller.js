import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

// admin
const createItems = asyncHandler(async(req,res)=>{
    const {name,pricing,sortOrderId,sortOrder} = req.body;

    if(!name) throw new apiError(400,"item name is required");
    if(pricing === undefined || pricing === null || pricing === "") throw new apiError(400,"pricing is required");

    const itemData = await prisma.items.create({
        data:{
            name:name,
            pricing:String(pricing),
            sortOrderId:Number(sortOrderId ?? sortOrder ?? 0)
        }
    });

    if(!itemData) throw new apiError(400,"creation of items error!");
    return res.status(201).json(new apiResponse(201,itemData,"item created successfully"));
});

// admin 
const mapItems = asyncHandler(async(req,res)=>{
    const {categoryName,cuisineName,menuItems} = req.body;

    if(!categoryName) throw new apiError(400,"category name is required");
    if(!Array.isArray(menuItems) || menuItems.length === 0) throw new apiError(400,"Not a array passed with menu items");

    const requestedItems = menuItems.map((item)=>{
        if(typeof item === "string"){
            return {
                name:item
            };
        }

        return {
            id:item.id || item.itemId,
            name:item.name || item.itemName,
            sortOrderId:item.sortOrderId
        };
    });

    const itemWhere = requestedItems
        .map((item)=>{
            const conditions = [];

            if(item.id !== undefined && item.id !== null){
                conditions.push({id:String(item.id)});
            }

            if(item.name){
                conditions.push({name:{equals:item.name,mode:"insensitive"}});
            }

            return conditions.length ? {OR:conditions} : null;
        })
        .filter(Boolean);

    if(itemWhere.length !== requestedItems.length) throw new apiError(400,"item id or name is required");

    const categoryWhere = {
        OR:[
            {name:{equals:categoryName,mode:"insensitive"}},
            {slug:categoryName.toUpperCase()}
        ]
    };

    if(cuisineName){
        categoryWhere.cuisine = {
            is:{
                OR:[
                    {name:{equals:cuisineName,mode:"insensitive"}},
                    {slug:cuisineName.toUpperCase()}
                ]
            }
        };
    }

    const categoryData = await prisma.categories.findFirst({
        where:{
            ...categoryWhere
        },
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

    if(!categoryData) throw new apiError(404,cuisineName ? "category not found for selected cuisine" : "category not found");

    const itemsData = await prisma.items.findMany({
        where:{
            OR:itemWhere
        },
        include:{
            category:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
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

    const alreadyAssignedItems = itemsData.filter((item)=>item.categoryId);

    if(alreadyAssignedItems.length > 0){
        const assignedNames = alreadyAssignedItems.map((item)=>{
            if(item.categoryId === categoryData.id){
                return `${item.name} is already assigned to ${categoryData.name}`;
            }

            return `${item.name} is already assigned to ${item.category?.name || "another category"}`;
        });

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
                }
            }
        }
    });

    if(!updatedCategoryData) throw new apiError(400,"category update failed");

    return res.status(200).json(new apiResponse(200,updatedCategoryData,"mapping of category and item updated successfully"));
});

// user and admin
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
                }
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
        include:{
            category:{
                select:{
                    id:true,
                    name:true,
                    slug:true
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,items,"items fetched successfully"));
});

const fetchOnlyItems = asyncHandler(async(req,res)=>{
    const items = await prisma.items.findMany({
        orderBy:{
            sortOrderId:"asc"
        }
    });

    return res.status(200).json(new apiResponse(200,items,"items fetched successfully"));
});

// admin
const editItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;
    const {itemName,name,sortOrderId,sortOrder} = req.body;

    if(!itemId) throw new apiError(400,"item id is required");
    if(!itemName && !name && sortOrderId === undefined && sortOrder === undefined) throw new apiError(400,"no item data passed");

    const dataToUpdate = {};
    const updatedName = itemName || name;

    if(updatedName){
        dataToUpdate.name = updatedName;
    }

    if(sortOrderId !== undefined || sortOrder !== undefined){
        dataToUpdate.sortOrderId = Number(sortOrderId ?? sortOrder);
    }

    const updatedItem = await prisma.items.update({
        where:{
            id:itemId
        },
        data:dataToUpdate
    });

    return res.status(200).json(new apiResponse(200,updatedItem,"item updated successfully"));
});

// admin
const deleteItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;

    if(!itemId) throw new apiError(400,"item id is required");

    const deletedItem = await prisma.items.delete({
        where:{
            id:itemId
        }
    });

    return res.status(200).json(new apiResponse(200,deletedItem,"item deleted successfully"));
});


const addPersonalProduct = asyncHandler(async(req,res)=>{
    const sellerId = req.userData?.id;
    const {cuisineName,categoryName,itemName,name,pricing,sortOrderId,sortOrder} = req.body;
    const customItemName = itemName || name;

    if(!sellerId) throw new apiError(401,"Unauthorized user");
    if(!cuisineName) throw new apiError(400,"cuisine name is required");
    if(!categoryName) throw new apiError(400,"category name is required");
    if(!customItemName) throw new apiError(400,"item name is required");
    if(pricing === undefined || pricing === null || pricing === "") throw new apiError(400,"pricing is required");

    const categoryData = await prisma.categories.findFirst({
        where:{
            OR:[
                {name:{equals:categoryName,mode:"insensitive"}},
                {slug:categoryName.toUpperCase()}
            ],
            cuisine:{
                is:{
                    OR:[
                        {name:{equals:cuisineName,mode:"insensitive"}},
                        {slug:cuisineName.toUpperCase()}
                    ]
                }
            }
        },
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

    if(!categoryData) throw new apiError(404,"category not found for selected cuisine");

    const existingItem = await prisma.items.findFirst({
        where:{
            categoryId:categoryData.id,
            name:{
                equals:customItemName,
                mode:"insensitive"
            }
        }
    });

    if(existingItem) throw new apiError(409,`${customItemName} is already created and assigned to ${categoryData.name}`);

    const customItem = await prisma.items.create({
        data:{
            name:customItemName,
            pricing:String(pricing),
            sortOrderId:Number(sortOrderId ?? sortOrder ?? 0),
            category:{
                connect:{
                    id:categoryData.id
                }
            }
        },
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
    });

    return res.status(201).json(new apiResponse(201,customItem,"custom item created and assigned successfully"));
});



export { createItems, mapItems, fetchItemsToCategory, fetchAllItems, fetchOnlyItems, editItem, deleteItem, addPersonalProduct };
