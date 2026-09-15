/** The one sender address, read once. Used by every email this app sends. */
export const FROM_ADDRESS = (process.env.RESEND_FROM_ADDRESS ?? 'Get Lucky Golf <noreply@getluckygolf.co.za>').trim()
