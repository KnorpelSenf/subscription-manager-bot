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

type SpreadsheetRow = [string, 'TRUE' | 'FALSE', number | undefined]

async function newUser(message: Message.TextMessage): Promise<void> {
    const chat_id = message.chat.id
    const token = await getSheetToken()
    if (!token) {
        apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        return
    }
    const s = google.sheets('v4').spreadsheets

    const range = await s.values.get({
        spreadsheetId: sheetId,
        oauth_token: token,
        range: 'A2:C',
    })
    const emails = range.data.values as SpreadsheetRow[] | undefined
    if (!emails) {
        apiCall('sendMessage', {
            chat_id,
            text:
                'Your message is missing an email! Please start this bot by clicking the link you received.',
        })
        return
    }

    const emailCode = message.text.substr('/start'.length).trim()
    const email = Buffer.from(emailCode, 'base64').toString('ascii')
    const index = emails.findIndex(row => row[0] === email && row[1] === 'TRUE')
    if (index === -1) {
        apiCall('sendMessage', {
            chat_id,
            text: `Sorry! You're out with ${email}!`,
        })
        return
    }

    const row = emails[index]
    if (row[2]) {
        apiCall('sendMessage', {
            chat_id,
            text: `You're already registered with ${email}!`,
        })
    } else {
        const range = 'C' + (index + 2)
        await s.values.update({
            spreadsheetId: sheetId,
            range,
            valueInputOption: 'RAW',
            oauth_token: token,
            requestBody: {
                range,
                majorDimension: 'ROWS',
                values: [[chat_id]],
            },
        })
        apiCall('sendMessage', {
            chat_id,
            text: `Welcome! You're in with ${email}!`,
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
        if (
            'text' in message &&
            message.chat.type === 'private' &&
            message.text.startsWith('/start')
        ) {
            await newUser(message)
        } else if ('new_chat_members' in message) {
            verifyMembers(message)
        }
    }
    res.end()
}
