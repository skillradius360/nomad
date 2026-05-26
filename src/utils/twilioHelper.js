import twilio from "twilio"

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN

)

export async function twilioSMSHelper(phone,from,message) {

    try {
        const data = await client.messages
            .create({
                body: message,
                from: from,
                to:  `+91${phone}`
            })

            if (data.status=="failed") throw new Error("sms message failed")
    return ({
        body:data.body,
        status:data.status,
        from:data.from,
        to:data.to,
        direction:data.direction,
        sentDate:data.sentDate,
        message:data.errorMessage
    })

    } catch (error) {
        // console.log(data.errorCode)
        throw new Error(error)
    }
}