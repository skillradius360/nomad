import { v2 as cloudinary } from 'cloudinary';
import fs from "fs";


cloudinary.config({
    cloud_name:process.env.CLOUDINARY_CLOUD_NAME, 
        api_key:process.env.CLOUDINARY_API_KEY, 
        api_secret:process.env.CLOUDINARY_API_SECRET// Click 'View API Keys' above to copy your API secret
});


const removeLocalFile = (filepath) => {
    if (filepath && fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
    }
};

const cloudUploader = async function (filepath) {
    try {
        if (!filepath) {
            return null;
        }

        const uploadResult = await cloudinary.uploader
            .upload(filepath, {
                resource_type: "auto"
            })
        removeLocalFile(filepath);
        console.log("The content is uploaded at"+uploadResult.url)

        return uploadResult
    } catch (error) {
        removeLocalFile(filepath);
        console.log("error occured during file uploading"+error.message)
        return null;
    }
}


const cloudDataDeleter= async function (path){
    try {
        const id= path.split("/")[path.split("/").length-1].split(".")[0]
        console.log(id)
        const dataDeleteStatus  = await cloudinary.uploader.destroy(id)
        console.log(dataDeleteStatus)
        if(!dataDeleteStatus) throw new Error("deletion failed!")
        return dataDeleteStatus
    } catch (error) {
        console.error(error)
    }
    }

export {cloudUploader,cloudDataDeleter}
