import type { Request, Response } from 'express'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'
import { request } from 'https'
import type { Message, Opts, Telegram, Update } from 'typegram'

const GOOGLE_AUTH_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const botToken = process.env.BOT_TOKEN ?? ''
const sheetId = process.env.SHEET_ID ?? ''

if (!botToken || !sheetId) {
    throw new Error('Env var missing!')
}

// quickly implement telegram integration to reduce the number of dependencies
function apiCall<M extends keyof Telegram>(method: M, payload: Opts<M>): void {
    const data = JSON.stringify(payload)
    const req = request({
        hostname: 'api.telegram.org',
        path: '/bot' + botToken + '/' + method,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
        },
    })
    req.on('error', e => console.log(e))
    req.write(data)
    req.end()
}

// quickly implement auth procedure via google-auth-library because googleapis is just way too complicated
let jwt: JWT | undefined = undefined
async function getSheetToken(): Promise<string | null | undefined> {
    if (jwt === undefined) {
        const email = process.env.SHEET_CLIENT_EMAIL
        const key = process.env.SHEET_PRIVATE_KEY
        if (!email || !key) {
            console.log('No sheet auth set!')
            return undefined
        }
        jwt = new JWT({ email, key, scopes: GOOGLE_AUTH_SCOPES })
        await jwt.authorize()
    }
    return jwt.credentials.access_token
}

async function newUser(message: Message.TextMessage): Promise<void> {
    const token = await getSheetToken()
    if (token) {
        const range = await google.sheets('v4').spreadsheets.values.get({
            spreadsheetId: sheetId,
            oauth_token: token,
            range: 'A2:C',
        })
        const emails = range.data.values

        const emailCode = message.text.substr('/start'.length).trim()
        const email = Buffer.from(emailCode, 'base64').toString('ascii')
        if (
            emails &&
            emails.some(row => row[0] === email && row[1] === 'TRUE')
        ) {
            apiCall('sendMessage', {
                chat_id: message.chat.id,
                text: `You're in with ${email}!`,
            })
        } else {
            apiCall('sendMessage', {
                chat_id: message.chat.id,
                text: `You're out with ${email}!`,
            })
        }
    } else {
        apiCall('sendMessage', {
            chat_id: message.chat.id,
            text: 'Something went wrong on our end, sorry!',
        })
    }
}

function verifyMembers(message: Message.NewChatMembersMessage): void {
    apiCall('sendMessage', {
        chat_id: message.chat.id,
        text: 'Someone joined who is called ' + message.from?.first_name,
    })
}

export async function bot(req: Request, res: Response): Promise<void> {
    const update: Update = req.body
    console.log('UPDATE DATA', update)
    if ('message' in update) {
        const message = update.message
        if ('text' in message && message.text.startsWith('/start')) {
            await newUser(message)
        } else if ('new_chat_members' in message) {
            verifyMembers(message)
        }
    }
    res.end()
}
