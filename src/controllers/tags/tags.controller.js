import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const tagInclude = {
    itemTags:{
        include:{
            item:{
                select:{
                    id:true,
                    name:true,
                    imageUrl:true,
                    active:true
                }
            }
        }
    },
    comboTags:{
        include:{
            combo:{
                select:{
                    id:true,
                    name:true,
                    imageUrl:true,
                    active:true,
                    shopId:true
                }
            }
        }
    }
};

const makeSlug = (value)=>{
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g,"_")
        .replace(/^_+|_+$/g,"");
};

const parseBoolean = (value)=>{
    if(typeof value === "boolean") return value;
    if(["true","1","yes","on"].includes(String(value).toLowerCase())) return true;
    if(["false","0","no","off"].includes(String(value).toLowerCase())) return false;
    return null;
};

const parseTagIds = (value)=>{
    if(!value) return [];
    if(Array.isArray(value)) return value;

    try{
        const parsed = JSON.parse(value);
        if(Array.isArray(parsed)) return parsed;
    }catch(error){
    }

    throw new apiError(400,"tagIds must be a valid JSON array");
};

const normalizeTagIds = async(tagIds)=>{
    const uniqueTagIds = [...new Set(tagIds.map((tagId)=>String(tagId)).filter(Boolean))];

    if(!uniqueTagIds.length) throw new apiError(400,"tagIds must be a non-empty array");

    const tagCount = await prisma.tag.count({
        where:{
            id:{
                in:uniqueTagIds
            },
            active:true
        }
    });

    if(tagCount !== uniqueTagIds.length){
        throw new apiError(400,"one or more tag ids are invalid or inactive");
    }

    return uniqueTagIds;
};

const formatTag = (tag)=>({
    ...tag,
    items:tag.itemTags?.map((itemTag)=>itemTag.item) || [],
    combos:tag.comboTags?.map((comboTag)=>comboTag.combo) || [],
    itemTags:undefined,
    comboTags:undefined
});

const createTag = asyncHandler(async(req,res)=>{
    const {name,slug,active} = req.body;

    if(!name) throw new apiError(400,"tag name is required");

    const normalizedSlug = makeSlug(slug || name);
    if(!normalizedSlug) throw new apiError(400,"valid tag slug is required");

    const parsedActive = active === undefined ? true : parseBoolean(active);
    if(parsedActive === null) throw new apiError(400,"active must be true or false");

    const tag = await prisma.tag.create({
        data:{
            name:String(name).trim(),
            slug:normalizedSlug,
            active:parsedActive
        }
    }).catch((error)=>{
        if(error?.code === "P2002") throw new apiError(409,"tag slug already exists");
        throw error;
    });

    return res.status(201).json(new apiResponse(201,tag,"tag created successfully"));
});

const fetchAllTags = asyncHandler(async(req,res)=>{
    const tags = await prisma.tag.findMany({
        orderBy:{
            createdAt:"desc"
        },
        include:tagInclude
    });

    return res.status(200).json(new apiResponse(200,tags.map(formatTag),"tags fetched successfully"));
});

const fetchActiveTags = asyncHandler(async(req,res)=>{
    const tags = await prisma.tag.findMany({
        where:{
            active:true
        },
        orderBy:{
            name:"asc"
        }
    });

    return res.status(200).json(new apiResponse(200,tags,"active tags fetched successfully"));
});

const fetchTagById = asyncHandler(async(req,res)=>{
    const {tagId} = req.params;

    const tag = await prisma.tag.findUnique({
        where:{
            id:tagId
        },
        include:tagInclude
    });

    if(!tag) throw new apiError(404,"tag not found");

    return res.status(200).json(new apiResponse(200,formatTag(tag),"tag fetched successfully"));
});

const updateTag = asyncHandler(async(req,res)=>{
    const {tagId} = req.params;
    const {name,slug,active} = req.body;

    if(!name && !slug && active === undefined) throw new apiError(400,"no tag data passed");

    const dataToUpdate = {};
    if(name) dataToUpdate.name = String(name).trim();
    if(slug || name) dataToUpdate.slug = makeSlug(slug || name);

    if(active !== undefined){
        const parsedActive = parseBoolean(active);
        if(parsedActive === null) throw new apiError(400,"active must be true or false");
        dataToUpdate.active = parsedActive;
    }

    const tag = await prisma.tag.update({
        where:{
            id:tagId
        },
        data:dataToUpdate
    }).catch((error)=>{
        if(error?.code === "P2025") return null;
        if(error?.code === "P2002") throw new apiError(409,"tag slug already exists");
        throw error;
    });

    if(!tag) throw new apiError(404,"tag not found");

    return res.status(200).json(new apiResponse(200,tag,"tag updated successfully"));
});

const updateTagActiveStatus = asyncHandler(async(req,res)=>{
    const {tagId} = req.params;
    const active = parseBoolean(req.body.active);

    if(active === null) throw new apiError(400,"active must be true or false");

    const tag = await prisma.tag.update({
        where:{
            id:tagId
        },
        data:{
            active
        }
    }).catch(()=>null);

    if(!tag) throw new apiError(404,"tag not found");

    return res.status(200).json(new apiResponse(200,tag,`tag ${active ? "activated" : "deactivated"} successfully`));
});

const deleteTag = asyncHandler(async(req,res)=>{
    const {tagId} = req.params;

    const tag = await prisma.tag.delete({
        where:{
            id:tagId
        }
    }).catch(()=>null);

    if(!tag) throw new apiError(404,"tag not found");

    return res.status(200).json(new apiResponse(200,tag,"tag deleted successfully"));
});

const assignTagsToItem = asyncHandler(async(req,res)=>{
    const {itemId} = req.params;
    const tagIds = await normalizeTagIds(parseTagIds(req.body.tagIds));

    const item = await prisma.items.findUnique({
        where:{
            id:itemId
        },
        select:{
            id:true
        }
    });

    if(!item) throw new apiError(404,"item not found");

    const updatedItem = await prisma.$transaction(async(tx)=>{
        await tx.itemTag.deleteMany({
            where:{
                itemId
            }
        });

        await tx.itemTag.createMany({
            data:tagIds.map((tagId)=>({
                itemId,
                tagId
            })),
            skipDuplicates:true
        });

        return tx.items.findUnique({
            where:{
                id:itemId
            },
            include:{
                tags:{
                    include:{
                        tag:true
                    }
                }
            }
        });
    });

    return res.status(200).json(new apiResponse(200,updatedItem,"item tags updated successfully"));
});

const removeTagFromItem = asyncHandler(async(req,res)=>{
    const {itemId,tagId} = req.params;

    await prisma.itemTag.deleteMany({
        where:{
            itemId,
            tagId
        }
    });

    return res.status(200).json(new apiResponse(200,null,"tag removed from item successfully"));
});

const assignTagsToCombo = asyncHandler(async(req,res)=>{
    const {comboId} = req.params;
    const tagIds = await normalizeTagIds(parseTagIds(req.body.tagIds));

    const combo = await prisma.combo.findUnique({
        where:{
            id:comboId
        },
        select:{
            id:true
        }
    });

    if(!combo) throw new apiError(404,"combo not found");

    const updatedCombo = await prisma.$transaction(async(tx)=>{
        await tx.comboTag.deleteMany({
            where:{
                comboId
            }
        });

        await tx.comboTag.createMany({
            data:tagIds.map((tagId)=>({
                comboId,
                tagId
            })),
            skipDuplicates:true
        });

        return tx.combo.findUnique({
            where:{
                id:comboId
            },
            include:{
                tags:{
                    include:{
                        tag:true
                    }
                }
            }
        });
    });

    return res.status(200).json(new apiResponse(200,updatedCombo,"combo tags updated successfully"));
});

const removeTagFromCombo = asyncHandler(async(req,res)=>{
    const {comboId,tagId} = req.params;

    await prisma.comboTag.deleteMany({
        where:{
            comboId,
            tagId
        }
    });

    return res.status(200).json(new apiResponse(200,null,"tag removed from combo successfully"));
});

export {
    assignTagsToCombo,
    assignTagsToItem,
    createTag,
    deleteTag,
    fetchActiveTags,
    fetchAllTags,
    fetchTagById,
    removeTagFromCombo,
    removeTagFromItem,
    updateTag,
    updateTagActiveStatus,
};
