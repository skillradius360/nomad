import { executeDailyBilling } from "../controllers/billing/billing.controller.js";

const IST_OFFSET_MS = 330 * 60 * 1000;

const getPreviousIstDate = ()=>{
    const shiftedNow = new Date(Date.now() + IST_OFFSET_MS);
    const previousDate = new Date(Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate() - 1
    ));
    return previousDate.toISOString().slice(0,10);
};

const millisecondsUntilNextRun = ()=>{
    const shiftedNow = new Date(Date.now() + IST_OFFSET_MS);
    const nextRunUtc = Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate() + 1,
        0,
        5
    ) - IST_OFFSET_MS;
    return Math.max(nextRunUtc - Date.now(),1000);
};

const startBillingScheduler = ()=>{
    const runPreviousDay = async()=>{
        try{
            const result = await executeDailyBilling(getPreviousIstDate());
            console.log(`Daily billing checked: ${result.billingDate}, ${result.settled} shops settled`);
        }catch(error){
            console.error("Daily billing failed:",error.message);
        }
    };

    const scheduleNext = ()=>{
        const timer = setTimeout(async()=>{
            try{
                await runPreviousDay();
            }finally{
                scheduleNext();
            }
        },millisecondsUntilNextRun());
        timer.unref?.();
    };

    void runPreviousDay();
    scheduleNext();
};

export { startBillingScheduler };
