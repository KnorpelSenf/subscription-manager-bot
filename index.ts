import type { Request, Response } from 'express'
import type { Opts, Telegram, Update } from 'typegram'
import * as https from 'https'

const botToken = process.env.BOT_TOKEN

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
    req.write(data)
    req.end()
}

export function bot(req: Request, res: Response): void {
    const update: Update = req.body
    console.log('update is', update)
    if ('message' in update) {
        const id = update.message.from.id
        apiCall('sendMessage', {
            chat_id: id,
            text: 'Hi, your user ID is' + id,
        })
    }
    res.end()
}
