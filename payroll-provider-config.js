'use strict';
const {createNotificationAdapter}=require('./payroll-delivery');
// Pure configuration inspection. No verify(), provider request, or worker start.
function createPayrollProviderConfig({env=process.env,nodemailer,fetchImpl=globalThis.fetch}={}){
 const emailReady=require('./payroll-resend').resendReady(env);
 const emailTransport=emailReady?require('./payroll-resend').createResendTransport({env,fetchImpl}):undefined;
 const readiness={email:emailReady,email_deferred:!emailReady,telegram:!!env.PAYROLL_TELEGRAM_BOT_TOKEN,encryption:/^[a-fA-F0-9]{64}$/.test(env.PAYROLL_ENCRYPTION_KEY||''),worker_enabled:env.PAYROLL_DELIVERY_ENABLED==='1'};
 return {readiness,adapter:createNotificationAdapter({emailTransport,emailFrom:env.PAYROLL_EMAIL_FROM,telegramToken:env.PAYROLL_TELEGRAM_BOT_TOKEN,fetchImpl,companyName:env.PAYROLL_COMPANY_NAME||'SiPeKA'})};
}
module.exports={createPayrollProviderConfig};
