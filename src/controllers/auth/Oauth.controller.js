import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
// import { app } from "../../app.js";
import { encodeAccessToken } from "../../utils/jwtPacker.js";


import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { apiError, apiResponse,asyncHandler } from "../../utils/handler.js";

import { twilioSMSHelper } from "../../utils/twilioHelper.js";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const OTP_EXPIRY_MS = 5 * 60 * 1000;

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

// Google OAuth Client
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const googleAuth = asyncHandler(async (req, res) => {
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
  });

  res.redirect(url);
});

const googleCallback = asyncHandler(async (req, res) => {
  const code = req.query.code;

  try {
    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Google authorization code is required",
      });
    }

    // Get Tokens with authorization code calling google
    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      throw new apiError(401, "Google ID token missing");
    }

    // Verify ID Token
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    // Get User Info
    const payload = ticket.getPayload();
    console.log(payload);

    if (!payload?.email) {
      throw new apiError(401, "Google account email missing");
    }

    let user = await prisma.user.findUnique({
      where: {
        email: payload.email,
      },
    });

    if (user?.isBlocked) {
      throw new  apiError(401, "User blocked or unauthorized")
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: payload.name ?? payload.given_name,
          email: payload.email,
          googleUid: payload.sub,
          loginType: "GOOGLE",
          profileImg: payload.picture,
        },
      });
    } else if (!user.googleUid || user.profileImg !== payload.picture || user.name !== payload.name) {

      user = await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          name: payload.name ?? user.name,
          googleUid: user.googleUid ?? payload.sub,
          profileImg: payload.picture ?? user.profileImg,
        },
      });
    }

    const jwt_token = encodeAccessToken(user.id, user.name, user.email, user.profileImg);

    return res.header("Authorization", `Bearer ${jwt_token}`).status(200).json({
      "msg": "auth",
      "accessToken": jwt_token,

    })


  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});



// ==========================
const otpAuth = asyncHandler(async (req, res) => {
  const { phone } = req.body

  if (!phone) {
    throw new apiError(400, "phone number not recieved")
  }


  // else {
  //    throw new apiError(400,"user does not exists!")
  // }

  // OTP IS GENERATED HERE ... IMP checckpoiny
  await prisma.oTP.deleteMany({
    where: {
      phone,
      verified: false
    }
  });

  const otpData = await prisma.oTP.create({
    data: {
      code: Math.floor(100000 + Math.random() * 900000).toString(),
      phone: phone,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS)
    }
  })
  if (!otpData) throw new apiError(400, "Otp creation error")
    
  const mainOtp = await twilioSMSHelper(phone,process.env.TWILIO_PHONE_NUMBER,  `FaFo verification code : ${otpData.code} \n\nThe code expires in 5 minutes.\n\nFor security reasons , never share this otp with anyone `)
  if(!mainOtp ) throw new apiError(400,"otp generation error",mainOtp)

  return  res.json(new apiResponse(200 ,"otp sent successfully"))
})



const otpCheck = asyncHandler(async (req, res) => {
  const { otp,phoneNo } = req.body;

  if (!otp || !phoneNo) {
    throw new apiError(400, "otp or phone number not received");
  }

  await prisma.oTP.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: new Date() } },
        { verified: true }
      ]
    }
  });

  const userdata = await prisma.oTP.findFirst({
    where: { 
      AND:[
        {code: otp.toString()} ,
        {phone:phoneNo},
        {verified: false},
        {expiresAt: { gt: new Date() }}
      ]
     },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (!userdata) {
    throw new apiError(400, "Invalid or expired OTP");
  }

  await prisma.oTP.update({
    where: {
      id: userdata.id
    },
    data: {
      verified: true
    }
  });

  let fetchedData = await prisma.user.findUnique({
    where: { phone: userdata.phone }
  });


  if (!fetchedData) {
    fetchedData = await prisma.user.create({
      data: {
        phone: userdata.phone,
        loginType: "OTP"
      }
    });
    // if(!fetchedData ) throw new apiError(400,"data creation problem occured for otp method")
  }

  const jwt_token = await encodeAccessToken(
    fetchedData.id,
    fetchedData.name,
    fetchedData.email,
    fetchedData.profileImg
  );

  return res
    .header("Authorization", `Bearer ${jwt_token}`)
    .status(200)
    .json({
      msg: "auth",
      accessToken: jwt_token
    });
});

const invalidateExpiredOtp = asyncHandler(async (req, res) => {
  const result = await prisma.oTP.deleteMany({
    where: {
      expiresAt: {
        lte: new Date()
      }
    }
  });

  return res
    .status(200)
    .json(new apiResponse(200, {
      deletedCount: result.count
    }, "expired OTPs invalidated"));
});

export { googleAuth, googleCallback, otpCheck, otpAuth, invalidateExpiredOtp }
