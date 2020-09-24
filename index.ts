import type { Request, Response } from 'express'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'
import { request } from 'https'
import type { Message, Opts, Telegram, Update, User } from 'typegram'

const GOOGLE_AUTH_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const botToken = process.env.BOT_TOKEN ?? ''
const sheetId = process.env.SHEET_ID ?? ''
const insiderChatId = process.env.INSIDER_CHAT_ID ?? -1

if (!botToken || !sheetId || insiderChatId === -1) {
    throw new Error('Env var missing!')
}

// quickly implement Telegram integration to reduce the number of dependencies
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

// [[[ BOT CLOUD FUNCTION ]]]

type SpreadsheetRow = [string, 'TRUE' | 'FALSE', number | undefined]

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

// +++ New user contacts bot +++
async function newUser(message: Message.TextMessage): Promise<void> {
    const chat_id = message.chat.id
    const s = google.sheets('v4').spreadsheets

    const token = await getSheetToken()
    if (!token) {
        apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not authenticate at Google Sheets API, no token!')
        return
    }

    const range = await s.values.get({
        spreadsheetId: sheetId,
        oauth_token: token,
        range: 'A2:C',
    })
    const emails = range.data.values as SpreadsheetRow[] | undefined
    if (!emails) {
        apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not read emails from Google Sheets API!')
        return
    }

    const emailCode = message.text.substr('/start'.length).trim()
    const email = Buffer.from(emailCode, 'base64').toString('ascii')
    const index = emails.findIndex(row => row[0] === email && row[1] === 'TRUE')

    if (index === -1) {
        apiCall('sendMessage', {
            chat_id,
            text: "Sorry! You're out!",
        })
        return
    }

    const row = emails[index]
    if (row[2]) {
        apiCall('sendMessage', {
            chat_id,
            text: "You're already registered!",
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
            text: "Welcome! You're in!",
        })
    }
}

// +++ New user joins insider chat +++
async function verifyMembers(
    message: Message.NewChatMembersMessage
): Promise<Promise<void>> {
    const chat_id = message.chat.id
    const s = google.sheets('v4').spreadsheets
    const token = await getSheetToken()
    if (!token) {
        apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not authenticate at Google Sheets API, no token!')
        return
    }

    const range = await s.values.get({
        spreadsheetId: sheetId,
        oauth_token: token,
        range: 'A2:C',
    })
    const emails = range.data.values as SpreadsheetRow[] | undefined
    if (!emails) {
        apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not read emails from Google Sheets API!')
        return
    }

    message.new_chat_members.forEach((newMember: User) =>
        verifyMember(chat_id, emails, newMember)
    )
}

function verifyMember(
    chat_id: number,
    emails: SpreadsheetRow[],
    newMember: User
): void {
    const index = emails.findIndex(
        row => row[2] === newMember.id && row[1] === 'TRUE'
    )
    if (index === -1) {
        apiCall('kickChatMember', {
            chat_id,
            user_id: newMember.id,
        })
        apiCall('sendMessage', {
            chat_id,
            text:
                'I just had to kick an unwanted user. (Admins can check the action log.)',
        })
    }
}

// [[[ CANCEL SUBSCRIPTION CLOUD FUNCTION ]]]

export async function cancelSubscription(
    req: Request,
    res: Response
): Promise<void> {
    const email = req.body.email

    const s = google.sheets('v4').spreadsheets
    const token = await getSheetToken()
    if (!token) {
        console.error('Could not authenticate at Google Sheets API, no token!')
        return
    }

    const range = await s.values.get({
        spreadsheetId: sheetId,
        oauth_token: token,
        range: 'A2:C',
    })
    const emails = range.data.values as SpreadsheetRow[] | undefined
    if (!emails) {
        console.error('Could not read emails from Google Sheets API!')
        return
    }

    const index = emails.findIndex(row => row[0] === email && row[1] === 'TRUE')
    if (index !== -1) {
        const row = emails[index]
        const user_id = row[2]
        if (user_id) {
            apiCall('kickChatMember', { chat_id: insiderChatId, user_id })
        }
    }

    res.end()
}
