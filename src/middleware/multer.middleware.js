import multer from "multer"
import {v4 as uuidv4} from "uuid"

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './public/temp')
  },
  filename: function (req, file, cb) {
    cb(null, "fafoImage"+uuidv4())
  }
})

export const upload = multer({
    storage
})