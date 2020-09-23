import type { Request, Response } from "express";

export function bot(req: Request, res: Response): void {
    res.send(JSON.stringify(req))
};
