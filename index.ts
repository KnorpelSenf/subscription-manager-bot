import type { Request, Response } from 'express'
import { JWT } from 'google-auth-library'
import { google } from 'googleapis'
import { request } from 'https'
import type {
    InlineKeyboardMarkup,
    Message,
    Opts,
    Telegram,
    Update,
    User,
} from 'typegram'

const GOOGLE_AUTH_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

const botToken = process.env.BOT_TOKEN ?? ''
const sheetId = process.env.SHEET_ID ?? ''
const insiderChatId = parseInt(process.env.INSIDER_CHAT_ID ?? '', 10) ?? -1

if (!botToken || !sheetId || insiderChatId === -1) {
    throw new Error('Env var missing!')
}

// quickly implement Telegram integration to reduce the number of dependencies
function apiCall<M extends keyof Telegram>(
    method: M,
    payload: Opts<M>
): Promise<ReturnType<Telegram[M]>> {
    if ('reply_markup' in payload) {
        // @ts-expect-error: the types are inconsistent with the API so that they can properly reflect the structure of the JSON
        payload.reply_markup = JSON.stringify(payload.reply_markup)
    }
    const data = JSON.stringify(payload)
    return new Promise((resolve, reject) => {
        const req = request(
            {
                hostname: 'api.telegram.org',
                path: '/bot' + botToken + '/' + method,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length,
                },
            },
            res => {
                let data = ''
                res.on('error', e => (console.error(e), reject(e)))
                res.on('data', chunk => (data += chunk))
                res.on('end', () => {
                    const r = JSON.parse(data)
                    if (!r.ok) reject(r.description)
                    else resolve(r.result)
                })
            }
        )
        req.write(data)
        req.end()
    })
}

// quickly implement auth procedure via google-auth-library because googleapis is just way too complicated
let jwt: JWT | undefined = undefined
async function getSheetToken(): Promise<string | null | undefined> {
    if (jwt === undefined) {
        const email = process.env.SHEET_CLIENT_EMAIL
        const key = process.env.SHEET_PRIVATE_KEY
        if (!email || !key) {
            console.error('No sheet auth set!')
            return undefined
        }
        jwt = new JWT({ email, key, scopes: GOOGLE_AUTH_SCOPES })
        await jwt.authorize()
    }
    return jwt.credentials.access_token
}

// [[[ REDIRECT TO BOT CLOUD FUNCTION ]]]

export async function register(req: Request, res: Response): Promise<void> {
    const { email } = req.query
    const emailString = email?.toString() ?? ''
    const emailCode = Buffer.from(emailString, 'ascii').toString('base64')
    const me = await apiCall('getMe', {})
    res.redirect('https://telegram.me/' + me.username + '?start=' + emailCode)
}

// [[[ BOT CLOUD FUNCTION ]]]

type SpreadsheetRow = [string, 'TRUE' | 'FALSE', string | undefined]

export async function bot(req: Request, res: Response): Promise<void> {
    const update: Update = req.body
    if ('message' in update) {
        const message = update.message
        if (
            'text' in message &&
            message.chat.type === 'private' &&
            message.text.startsWith('/start')
        ) {
            await newUser(message)
        } else if (
            message.chat.id === insiderChatId &&
            'new_chat_members' in message
        ) {
            await verifyMembers(message)
        }
    }
    res.end()
}

// +++ New user contacts bot +++
async function newUser(message: Message.TextMessage): Promise<void> {
    const chat_id = message.chat.id
    const s = google.sheets('v4').spreadsheets

    // check if we can use sheet
    const token = await getSheetToken()
    if (!token) {
        await apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not authenticate at Google Sheets API, no token!')
        return
    }

    // check if we can access the email addresses in it
    const range = await s.values.get({
        spreadsheetId: sheetId,
        oauth_token: token,
        range: 'A2:C',
    })
    const emails = range.data.values as SpreadsheetRow[] | undefined
    if (!emails) {
        await apiCall('sendMessage', {
            chat_id,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not read emails from Google Sheets API!')
        return
    }

    // check if the provided email belongs to a paying customer
    const emailCode = message.text.substr('/start'.length).trim()
    const email = Buffer.from(emailCode, 'base64').toString('ascii')
    const index = emails.findIndex(row => row[0] === email && row[1] === 'TRUE')
    if (index === -1) {
        await apiCall('sendMessage', {
            chat_id,
            text: "Sorry! You're out!",
        })
        return
    }

    // check if that customer has not linked a different account before
    const existingTelegramUserId = parseInt(emails[index][2] ?? '', 10)
    const isExistingUser = !isNaN(existingTelegramUserId)
    if (isExistingUser && existingTelegramUserId !== chat_id) {
        await apiCall('sendMessage', {
            chat_id,
            text:
                "You're already registered with a different Telegram account!",
        })
        return
    }

    // all checks done, we can now send the invitation link!

    await apiCall('unbanChatMember', {
        chat_id: insiderChatId,
        user_id: chat_id,
    }).catch(() => {
        // could fail if member is admin, then just do nothing
    })

    const reply_markup = await getInviteReplyMarkup()

    let text: string
    if (isExistingUser) {
        text = "You're already registered!"
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
        text = "Welcome! You're in!"
    }

    await apiCall('sendMessage', { chat_id, text, reply_markup })
}

// +++ New user joins insider chat +++
async function verifyMembers(
    message: Message.NewChatMembersMessage
): Promise<void> {
    const s = google.sheets('v4').spreadsheets
    const token = await getSheetToken()
    if (!token) {
        await apiCall('sendMessage', {
            chat_id: insiderChatId,
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
        await apiCall('sendMessage', {
            chat_id: insiderChatId,
            text: 'Something went wrong on our end, sorry!',
        })
        console.error('Could not read emails from Google Sheets API!')
        return
    }

    await Promise.all(
        message.new_chat_members.map((newMember: User) =>
            verifyMember(emails, newMember)
        )
    )
}

async function verifyMember(
    emails: SpreadsheetRow[],
    newMember: User
): Promise<void> {
    const index = emails.findIndex(
        row =>
            row[2] !== undefined &&
            parseInt(row[2], 10) === newMember.id &&
            row[1] === 'TRUE'
    )
    if (index === -1) {
        await apiCall('kickChatMember', {
            chat_id: insiderChatId,
            user_id: newMember.id,
        })
    }
}

async function getInviteReplyMarkup(): Promise<InlineKeyboardMarkup> {
    const chat = await apiCall('getChat', { chat_id: insiderChatId })
    const url =
        'invite_link' in chat && chat.invite_link !== undefined
            ? chat.invite_link
            : await apiCall('exportChatInviteLink', { chat_id: insiderChatId })
    return { inline_keyboard: [[{ text: 'GET INSIGHTS', url }]] }
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
        const range = 'B' + (index + 2)
        await s.values.update({
            spreadsheetId: sheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            oauth_token: token,
            requestBody: {
                range,
                majorDimension: 'ROWS',
                values: [['FALSE']],
            },
        })
        const row = emails[index]
        const id = row[2]
        if (id) {
            await apiCall('kickChatMember', {
                chat_id: insiderChatId,
                user_id: parseInt(id, 10),
            })
        }
    }

    res.end()
}
