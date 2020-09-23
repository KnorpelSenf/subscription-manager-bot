import type { Request, Response } from 'express'
import * as https from 'https'
import type { Message, Opts, Telegram, Update } from 'typegram'
import { readFileSync } from 'fs'
import { google } from 'googleapis'
import { JWT } from 'google-auth-library'

const GOOGLE_AUTH_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const botToken = process.env.BOT_TOKEN ?? ''
const sheetId = process.env.SHEET_ID ?? ''

if (!botToken || !sheetId) {
    throw new Error('Env var missing!')
}

// quickly implement telegram integration to reduce the number of dependencies
function apiCall<M extends keyof Telegram>(method: M, payload: Opts<M>): void {
    const data = JSON.stringify(payload)
    const req = https.request({
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
        const content = readFileSync('./credentials.json').toString()
        const credentials = JSON.parse(content)
        jwt = new JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: GOOGLE_AUTH_SCOPES,
        })
        await jwt.authorize()
    }
    return jwt.credentials.access_token
}

async function newUser(message: Message.TextMessage): Promise<void> {
    const email = message.text.substr('/start'.length).trim()
    const token = await getSheetToken()
    if (token) {
        const range = await google.sheets('v4').spreadsheets.values.get({
            spreadsheetId: sheetId,
            oauth_token: token,
            range: 'A2:C',
        })
        const emails = range.data.values

        if (
            emails &&
            emails.some(row => row[0] === email && row[1] === 'TRUE')
        ) {
            apiCall('sendMessage', {
                chat_id: message.chat.id,
                text: "You're in!",
            })
        } else {
            apiCall('sendMessage', {
                chat_id: message.chat.id,
                text: "You're out!",
            })
        }
    } else {
        apiCall('sendMessage', {
            chat_id: message.chat.id,
            text: `Something went wrong on our end, sorry!`,
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
    if ('message' in update) {
        const message = update.message
        if ('text' in message && message.text.startsWith('/start')) {
            await newUser(message)
        } else if ('new_chat_members' in message) {
            verifyMembers(message)
        }

        const id = update.message.from.id
        apiCall('sendMessage', {
            chat_id: id,
            text: 'Hi, your user ID is ' + id,
        })
    }
    res.end()
}
